import type { Employee, Settings, Trip, Violation } from "./types";
import { formatHours, hoursBetween, nightOverlapMinutes, parseHM } from "./time";

/** Изчислена повеска. */
export type TripCalc = {
  /** Обща продължителност явка → освобождаване. */
  spanHours: number;
  /** Време "натам" (явка → пристигане в оборотния пункт). */
  outHours: number | null;
  /** Престой в оборотния пункт. */
  turnaroundHours: number | null;
  /** Време "обратно" (отправяне от оборота → освобождаване). */
  backHours: number | null;
  /** Отчетено работно време на повеската. */
  workHours: number;
  /** Нощни часове в работното време. */
  nightHours: number;
  /** Брои ли се престоят в оборота като работно време (чл.17: ≤2 ч. или без стая за отдих). */
  turnaroundIsWork: boolean;
  /** Минимално изискуемата почивка в оборота по чл.17 (75% от времето "натам"). */
  requiredTurnaroundRest: number | null;
};

function nightHoursOf(fromIso: string, toIso: string, settings: Settings): number {
  const from = new Date(fromIso);
  const start = from.getHours() * 60 + from.getMinutes();
  const dur = (new Date(toIso).getTime() - from.getTime()) / 60000;
  if (dur <= 0) return 0;
  return nightOverlapMinutes(start, start + dur, settings.nightStart, settings.nightEnd) / 60;
}

export function calcTrip(trip: Trip, settings: Settings): TripCalc {
  const spanHours = hoursBetween(trip.yavka, trip.release);
  const hasTurn = Boolean(trip.arrivalTurnaround && trip.departureTurnaround);

  const outHours = trip.arrivalTurnaround ? hoursBetween(trip.yavka, trip.arrivalTurnaround) : null;
  const turnaroundHours = hasTurn ? hoursBetween(trip.arrivalTurnaround!, trip.departureTurnaround!) : null;
  const backHours = trip.departureTurnaround ? hoursBetween(trip.departureTurnaround, trip.release) : null;

  // чл.17: при стая за отдих престой ≤2 ч. е работно време, >2 ч. е почивка.
  // Без стая за отдих целият престой остава работно време.
  const turnaroundIsWork = !hasTurn || !trip.restRoom || (turnaroundHours ?? 0) <= 2;

  const workHours = turnaroundIsWork ? spanHours : (outHours ?? 0) + (backHours ?? 0);

  let nightHours: number;
  if (turnaroundIsWork) {
    nightHours = nightHoursOf(trip.yavka, trip.release, settings);
  } else {
    nightHours =
      nightHoursOf(trip.yavka, trip.arrivalTurnaround!, settings) +
      nightHoursOf(trip.departureTurnaround!, trip.release, settings);
  }

  const requiredTurnaroundRest =
    outHours !== null && outHours > 6 ? outHours * 0.75 : null;

  return { spanHours, outHours, turnaroundHours, backHours, workHours, nightHours, turnaroundIsWork, requiredTurnaroundRest };
}

/**
 * Безизвикателна система (D.4.1 т.2): най-ранната допустима следваща явка
 * след връщане от повеска — "колкото си отработил, толкова и почиваш",
 * но не по-малко от минимума по чл.16 / чл.16а.
 */
export function nextAllowedYavka(
  trip: Trip,
  settings: Settings,
  opts: { reducedRestAvailable?: boolean } = {},
): { iso: string; restHours: number; reason: string } {
  const c = calcTrip(trip, settings);
  let rest = 12;
  let reason = "чл.16 — междусменна почивка не по-малко от 12 ч.";

  if (c.outHours !== null && c.outHours > 6) {
    reason = "чл.17 — след пътуване над 6 ч. почивката в местослуженето е не по-малко от 12 ч.";
  }
  if (trip.international && opts.reducedRestAvailable) {
    rest = 9;
    reason = "чл.16а — намалена дневна почивка 9 ч. (веднъж на 7 дни, разликата се прибавя към следващата почивка).";
  }
  return {
    iso: new Date(new Date(trip.release).getTime() + rest * 3600000).toISOString(),
    restHours: rest,
    reason,
  };
}

/** Правен двигател за модул "Рейси" — B.1–B.4, чл.17 и блока B.7. */
export function validateTrips(
  trips: Trip[],
  employees: Employee[],
  settings: Settings,
): Violation[] {
  const out: Violation[] = [];
  const byEmp = new Map<string, Trip[]>();
  for (const t of trips) {
    if (!byEmp.has(t.employeeId)) byEmp.set(t.employeeId, []);
    byEmp.get(t.employeeId)!.push(t);
  }

  for (const [empId, list] of byEmp) {
    if (!employees.some((e) => e.id === empId)) continue;
    list.sort((a, b) => a.yavka.localeCompare(b.yavka));

    let nightRun: Trip[] = [];
    const flushNightRun = () => {
      if (nightRun.length > 2) {
        out.push({
          id: `t-art15-${nightRun[0].id}`, severity: "error", article: "чл.15 ал.3",
          employeeId: empId, tripId: nightRun[2].id,
          message: `${nightRun.length} последователни нощни повески — допустими са най-много 2.`,
        });
      }
      nightRun = [];
    };

    list.forEach((trip, i) => {
      const c = calcTrip(trip, settings);
      const approved = trip.extension?.approved === true;
      const maxWork = approved ? 14 : 12;

      // ── B.1 / чл.13, чл.14: продължителност на работното време ───────────
      // Когато престоят в оборотния пункт е истинска почивка (стая за отдих и
      // над 2 часа по чл.17), повеската се състои от две отделни работни части
      // и границата от 12 ч. важи за всяка от тях поотделно — затова чл.17
      // изобщо допуска общо време натам+обратно над 12 ч. Ако престоят се
      // отчита като работно време, цялата повеска е една смяна.
      const parts: { label: string; hours: number }[] = c.turnaroundIsWork
        ? [{ label: "Повеска", hours: c.workHours }]
        : [
            { label: 'Частта "натам"', hours: c.outHours ?? 0 },
            { label: 'Частта "обратно"', hours: c.backHours ?? 0 },
          ];

      for (const part of parts) {
        if (part.hours > 14) {
          out.push({
            id: `t-art14h-${trip.id}-${part.label}`, severity: "error", article: "чл.14 ал.1",
            employeeId: empId, tripId: trip.id,
            message: `${part.label}: ${formatHours(part.hours)} ч. — над пределните 14 ч.`,
          });
        } else if (part.hours > maxWork) {
          out.push({
            id: `t-art14-${trip.id}-${part.label}`, severity: "error", article: "чл.13 ал.1, чл.14",
            employeeId: empId, tripId: trip.id,
            message: `${part.label}: ${formatHours(part.hours)} ч. над 12 ч. без оформено удължаване по чл.14.`,
          });
        } else if (part.hours > 12 && approved) {
          out.push({
            id: `t-art14ok-${trip.id}-${part.label}`, severity: "info", article: "чл.14 ал.2",
            employeeId: empId, tripId: trip.id,
            message: `${part.label}: удължаване до ${formatHours(part.hours)} ч. — писмена заповед с обосновка в 2-дневен срок.`,
          });
        }
      }

      // ── чл.17: почивка в оборотния пункт ────────────────────────────────
      const totalTravel = (c.outHours ?? 0) + (c.backHours ?? 0);
      if (c.requiredTurnaroundRest !== null && totalTravel > 12) {
        const actual = c.turnaroundHours ?? 0;
        if (actual < c.requiredTurnaroundRest) {
          out.push({
            id: `t-art17-${trip.id}`, severity: "error", article: "чл.17",
            employeeId: empId, tripId: trip.id,
            message: `Пътуване "натам" ${formatHours(c.outHours!)} ч. (над 6 ч.): почивката в оборотния пункт е ${formatHours(actual)} ч., изисква се не по-малко от ${formatHours(c.requiredTurnaroundRest)} ч. (75%).`,
          });
        }
      }
      if (!trip.restRoom && c.workHours > maxWork) {
        out.push({
          id: `t-art17-room-${trip.id}`, severity: "error", article: "чл.17",
          employeeId: empId, tripId: trip.id,
          message: `Без стая за отдих в оборотния пункт общото време не може да надвишава ${maxWork} ч.; изчислено ${formatHours(c.workHours)} ч.`,
        });
      }
      if (trip.restRoom && c.turnaroundHours !== null && c.turnaroundHours <= 2) {
        out.push({
          id: `t-art17-idle-${trip.id}`, severity: "info", article: "чл.17",
          employeeId: empId, tripId: trip.id,
          message: `Престой в оборота ${formatHours(c.turnaroundHours)} ч. (≤2 ч.) се отчита като работно време.`,
        });
      }

      // ── чл.16 / чл.17: почивка в местослуженето между повеските ─────────
      const prev = list[i - 1];
      if (prev) {
        const rest = hoursBetween(prev.release, trip.yavka);
        const prevOut = calcTrip(prev, settings).outHours ?? 0;
        const minRest = trip.international ? 9 : 12;
        if (rest < minRest) {
          out.push({
            id: `t-rest-${trip.id}`, severity: "error",
            article: trip.international ? "чл.16а" : "чл.16",
            employeeId: empId, tripId: trip.id,
            message: `Почивка в местослуженето ${formatHours(rest)} ч. преди повеската — под минимума от ${minRest} ч.`,
          });
        } else if (rest < 12 && trip.international) {
          out.push({
            id: `t-rest9-${trip.id}`, severity: "warning", article: "чл.16а",
            employeeId: empId, tripId: trip.id,
            message: `Намалена дневна почивка ${formatHours(rest)} ч. — допустима веднъж на 7 дни; разликата до 12 ч. се прибавя към следващата почивка.`,
          });
        }
        if (prevOut > 6 && rest < 12) {
          out.push({
            id: `t-rest17-${trip.id}`, severity: "error", article: "чл.17",
            employeeId: empId, tripId: trip.id,
            message: `След предходно пътуване над 6 ч. почивката в местослуженето трябва да е не по-малко от 12 ч.; налице са ${formatHours(rest)} ч.`,
          });
        }
      }

      // ── B.7: интероперативни гранични превози ───────────────────────────
      if (trip.international) {
        if (!c.turnaroundIsWork && (c.turnaroundHours ?? 0) < 8) {
          out.push({
            id: `t-b7-away-${trip.id}`, severity: "error", article: "чл.16а",
            employeeId: empId, tripId: trip.id,
            message: `Почивка извън дома ${formatHours(c.turnaroundHours ?? 0)} ч. — минимумът е 8 ч. на 24 ч.`,
          });
        }
        const needBreak = c.workHours > 8 ? 45 : c.workHours >= 6 ? 30 : 0;
        if (needBreak > 0 && !trip.secondDriver && (trip.breakMinutes ?? 0) < needBreak) {
          out.push({
            id: `t-b7-break-${trip.id}`, severity: "error", article: "чл.17б",
            employeeId: empId, tripId: trip.id,
            message: `При повеска ${formatHours(c.workHours)} ч. се изисква почивка ${needBreak} мин. (част от нея между 3-ия и 6-ия час); въведени са ${trip.breakMinutes ?? 0} мин.`,
          });
        }
        const drivingDay = (trip.drivingOut ?? 0) + (trip.drivingBack ?? 0);
        const nightTrip = c.nightHours > 0;
        const maxDriving = nightTrip ? 8 : 9;
        if (drivingDay > maxDriving) {
          out.push({
            id: `t-b7-drive-${trip.id}`, severity: "error", article: "чл.17б",
            employeeId: empId, tripId: trip.id,
            message: `Време на управление ${formatHours(drivingDay)} ч. — максимумът между две почивки е ${maxDriving} ч. (${nightTrip ? "нощ" : "ден"}).`,
          });
        }
      }

      if (c.nightHours > 0) nightRun.push(trip);
      else flushNightRun();
    });
    flushNightRun();

    // ── B.7: 80 ч. управление за 2 седмици ────────────────────────────────
    const intl = list.filter((t) => t.international);
    for (let i = 0; i < intl.length; i++) {
      const start = new Date(intl[i].yavka).getTime();
      const window = intl.filter((t) => {
        const ts = new Date(t.yavka).getTime();
        return ts >= start && ts < start + 14 * 86400000;
      });
      const total = window.reduce((a, t) => a + (t.drivingOut ?? 0) + (t.drivingBack ?? 0), 0);
      if (total > 80) {
        out.push({
          id: `t-b7-80-${intl[i].id}`, severity: "error", article: "чл.17б",
          employeeId: empId, tripId: intl[i].id,
          message: `${formatHours(total)} ч. управление за 2 седмици от ${new Date(intl[i].yavka).toLocaleDateString("bg-BG")} — максимумът е 80 ч.`,
        });
        break;
      }
    }
  }

  return out;
}

/** Продължителност на почивката в оборота като процент от времето "натам". */
export function turnaroundRestRatio(c: TripCalc): number | null {
  if (!c.outHours || !c.turnaroundHours) return null;
  return c.turnaroundHours / c.outHours;
}

export function tripNightStartsAt(trip: Trip, settings: Settings): boolean {
  const d = new Date(trip.yavka);
  const m = d.getHours() * 60 + d.getMinutes();
  const ns = parseHM(settings.nightStart);
  const ne = parseHM(settings.nightEnd);
  return ne <= ns ? m >= ns || m < ne : m >= ns && m < ne;
}
