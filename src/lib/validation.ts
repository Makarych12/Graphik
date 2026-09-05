import type { ResolvedSchedule, Settings, Violation } from "./types";
import { calcCell, calcEmployee, weeklyHours } from "./calc";
import { MONTHS_BG, countWorkingDays, daysInMonth, formatHours } from "./time";
import { holidayName } from "./holidays";

/**
 * Правен двигател за модул "Смени" (D.6).
 * Всяко нарушение носи препратка към конкретен член от Наредба № 50.
 */
export function validateSchedule(schedule: ResolvedSchedule, settings: Settings): Violation[] {
  const out: Violation[] = [];
  const { year, month } = schedule.header;
  const dim = daysInMonth(year, month);

  for (const emp of schedule.employees) {
    const row = schedule.cells[emp.id] ?? {};
    const calcs = new Map<number, ReturnType<typeof calcCell>>();
    for (let d = 1; d <= dim; d++) calcs.set(d, calcCell(row[d], d, emp, settings, schedule.header));

    // ── чл.13 ал.1 / чл.14: максимална продължителност на смяната ──────────
    for (let d = 1; d <= dim; d++) {
      const c = calcs.get(d)!;
      if (!c.code || c.code.category !== "work") continue;
      const approved = row[d]?.extension?.approved === true;
      const maxBase = emp.dailyNorm < 8 ? emp.dailyNorm + 1 : 12;
      if (c.workHours > 14) {
        out.push({
          id: `art14-hard-${emp.id}-${d}`, severity: "error", article: "чл.14 ал.1",
          employeeId: emp.id, day: d,
          message: `Смяна ${formatHours(c.workHours)} ч. — над пределните 14 ч. (12 ч. + удължаване до 2 ч.).`,
        });
      } else if (c.workHours > maxBase && !approved) {
        out.push({
          id: `art14-${emp.id}-${d}`, severity: "error", article: "чл.13 ал.1, чл.14",
          employeeId: emp.id, day: d,
          message: `Смяна ${formatHours(c.workHours)} ч. над максимума ${formatHours(maxBase, 0)} ч. без оформено удължаване по чл.14 (телефонограма + писмена заповед в 2-дневен срок).`,
        });
      } else if (c.workHours > maxBase && approved) {
        out.push({
          id: `art14-ok-${emp.id}-${d}`, severity: "info", article: "чл.14 ал.2",
          employeeId: emp.id, day: d,
          message: `Удължена смяна ${formatHours(c.workHours)} ч. — изисква писмена заповед с обосновка в 2-дневен срок.`,
        });
      }
    }

    // ── чл.16: междусменна почивка не по-малко от 12 часа ─────────────────
    let prevEnd: number | null = null;
    let prevDay = 0;
    for (let d = 1; d <= dim; d++) {
      const c = calcs.get(d)!;
      if (c.startAbs === undefined || c.endAbs === undefined) continue;
      if (prevEnd !== null) {
        const rest = (c.startAbs - prevEnd) / 60;
        if (rest < 12) {
          out.push({
            id: `art16-${emp.id}-${d}`, severity: "error", article: "чл.16",
            employeeId: emp.id, day: d,
            message: `Междусменна почивка ${formatHours(rest)} ч. между ${prevDay} и ${d} число — под минимума от 12 ч.`,
          });
        }
      }
      prevEnd = c.endAbs;
      prevDay = d;
    }

    // ── чл.15 ал.3: не повече от 2 последователни нощни смени ─────────────
    let run: number[] = [];
    const flushRun = () => {
      if (run.length > 2) {
        out.push({
          id: `art15-${emp.id}-${run[0]}`, severity: "error", article: "чл.15 ал.3",
          employeeId: emp.id, day: run[2],
          message: `${run.length} последователни нощни смени (дни ${run.join(", ")}) — допустими са най-много 2.`,
        });
      }
      run = [];
    };
    for (let d = 1; d <= dim; d++) {
      const c = calcs.get(d)!;
      if (c.nightHours > 0) run.push(d);
      else flushRun();
    }
    flushRun();

    // ── чл.8: прекъсвания на работния ден ─────────────────────────────────
    for (let d = 1; d <= dim; d++) {
      const c = calcs.get(d)!;
      if (!c.code) continue;
      const prek = c.code.breaks.filter((b) => b.kind === "prekasvane");
      if (prek.length > 2) {
        out.push({
          id: `art8-count-${emp.id}-${d}`, severity: "error", article: "чл.8",
          employeeId: emp.id, day: d,
          message: `${prek.length} прекъсвания на работния ден (код "${c.code.code}") — допустими са най-много 2.`,
        });
      }
      for (const b of prek) {
        const mins = ((): number => {
          const [h1, m1] = b.start.split(":").map(Number);
          const [h2, m2] = b.end.split(":").map(Number);
          const s = h1 * 60 + m1, e = h2 * 60 + m2;
          return e > s ? e - s : e + 1440 - s;
        })();
        if (mins < 60) {
          out.push({
            id: `art8-len-${emp.id}-${d}-${b.start}`, severity: "warning", article: "чл.8",
            employeeId: emp.id, day: d,
            message: `Прекъсване ${b.start}–${b.end} (${mins} мин.) при код "${c.code.code}" — под 1 час.`,
          });
        }
      }
    }

    // ── Седмична продължителност ──────────────────────────────────────────
    const weeks = weeklyHours(schedule, emp, settings);
    for (const [w, info] of Object.entries(weeks)) {
      if (info.hours > settings.weeklyMaxHours) {
        out.push({
          id: `week-${emp.id}-${w}`, severity: "error", article: "КТ чл.146 / D.6",
          employeeId: emp.id, day: info.days[info.days.length - 1],
          message: `Седмица ${w}: ${formatHours(info.hours)} ч. — над ${settings.weeklyMaxHours} ч.`,
        });
      }
    }

    // ── Доработка след отпуск (D.5 т.5) ───────────────────────────────────
    // Пренасянето на остатъка си работи както преди; тук само се казва защо е
    // отрицателен, за да не се бърка с обикновена недоработка.
    if (emp.carryOverReason) {
      const r = emp.carryOverReason;
      const [fy, fm] = r.fromMonth.split("-").map(Number);
      out.push({
        id: `carry-leave-${emp.id}`, severity: "info", article: "D.5 т.5",
        employeeId: emp.id,
        message: `Доработка от ${MONTHS_BG[fm - 1]} ${fy}: минусът от ${formatHours(r.hours)} ч. идва от ползван отпуск (${r.leaveDays} дни). Покрива се с доработки — кодове 4–9.`,
      });
    }

    // ── Баланс и извънреден труд ──────────────────────────────────────────
    const t = calcEmployee(schedule, emp, settings);
    if (t.diff > 0) {
      out.push({
        id: `overtime-${emp.id}`, severity: "warning", article: "чл.20 ал.3",
        employeeId: emp.id,
        message: `Над нормата с ${formatHours(t.diff)} ч. — часовете над нормата се третират като извънреден труд.`,
      });
    } else if (t.diff < 0) {
      out.push({
        id: `under-${emp.id}`, severity: "info", article: "чл.20 ал.1",
        employeeId: emp.id,
        message: `Под нормата с ${formatHours(-t.diff)} ч. (норма ${formatHours(t.norm)} ч., общо ${formatHours(t.total)} ч.).`,
      });
    }

    // ── Труд в официален празник (чл.264 КТ) ──────────────────────────────
    for (let d = 1; d <= dim; d++) {
      const c = calcs.get(d)!;
      if (c.holidayHours > 0) {
        out.push({
          id: `holiday-${emp.id}-${d}`, severity: "info", article: "чл.264 КТ",
          employeeId: emp.id, day: d,
          message: `Труд в официален празник (${holidayName(year, month, d)}) — ${formatHours(c.holidayHours)} ч.; заплаща се не по-малко от удвоения размер.`,
        });
      }
    }

    // ── Неявки ────────────────────────────────────────────────────────────
    for (let d = 1; d <= dim; d++) {
      const c = calcs.get(d)!;
      if (c.code?.category === "absent") {
        out.push({
          id: `absent-${emp.id}-${d}`, severity: "warning", article: "—",
          employeeId: emp.id, day: d,
          message: `Отбелязана неявка/самоотлъчка (код "${c.code.code}") на ${d} число.`,
        });
      }
    }

    // ── Запознаване срещу подпис (D.4.2) ──────────────────────────────────
    if (schedule.status !== "draft" && !emp.acknowledged) {
      out.push({
        id: `ack-${emp.id}`, severity: "info", article: "—",
        employeeId: emp.id,
        message: "Служителят още не е отбелязан като запознат с графика.",
      });
    }
  }

  // ── Съгласуваност на нормата с производствения календар ─────────────────
  const h = schedule.header;
  const calendarDays = countWorkingDays(h.year, h.month);
  if (Math.abs(h.normHours - calendarDays * 8) > 0.01) {
    out.push({
      id: "header-norm", severity: "info", article: "чл.20 ал.1",
      message: `НОРМА ${formatHours(h.normHours)} ч. се различава от производствения календар: ${calendarDays} работни дни × 8 ч. = ${formatHours(calendarDays * 8)} ч.`,
    });
  }

  return out;
}

export function violationsByCell(v: Violation[]): Map<string, Violation[]> {
  const m = new Map<string, Violation[]>();
  for (const x of v) {
    if (!x.employeeId || x.day === undefined) continue;
    const k = `${x.employeeId}:${x.day}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

export function worstSeverity(list: Violation[] | undefined): "error" | "warning" | null {
  if (!list?.length) return null;
  if (list.some((v) => v.severity === "error")) return "error";
  if (list.some((v) => v.severity === "warning")) return "warning";
  return null;
}
