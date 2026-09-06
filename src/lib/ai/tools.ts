"use client";

import { resolved, resolveEmployees, useApp, type CellChange, type PatchOp } from "@/lib/store";
import { calcAll, calcCell, calcEmployee, findCode } from "@/lib/calc";
import { validateSchedule } from "@/lib/validation";
import { calcTrip, nextAllowedYavka, validateTrips } from "@/lib/trips";
import { defaultPattern, describePattern, patternMonth } from "@/lib/patterns";
import * as db from "@/lib/db";
import {
  breaksMinutes, countWorkingDays, daysInMonth, formatDateTimeBG, formatHours,
  hoursBetween, scheduleId, spanMinutes, weekdayName,
} from "@/lib/time";
import type {
  Cell, Employee, ResolvedSchedule, RosterEmployee, ScheduleHeader, ShiftPattern, Trip, TripMode,
} from "@/lib/types";

/**
 * Инструментите на асистента (част D.7.2).
 *
 * Четенето става веднага. ВСЯКА промяна минава през едно и също гърло:
 * инструментът само съставя предложение (`proposePatch`), нарядчикът го вижда
 * в предпросмотъра „беше → ще стане“ и чак след „Приложи“ то се записва.
 * Асистентът няма достъп до общите настройки, до темата и до каквото и да е
 * извън графика, служителите и повеските.
 */

// ─── Описания на инструментите (OpenAI-съвместим формат) ────────────────────

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ToolDef => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, ...(required.length ? { required } : {}) },
  },
});

const P_MODULE = {
  type: "string",
  enum: ["smeni", "reisi"],
  description: '"smeni" — месечният график на смените; "reisi" — повеските на пътуващия персонал.',
};
const P_MONTH = { type: "integer", description: "Месец 1..12. По подразбиране отвореният месец." };
const P_YEAR = { type: "integer", description: "Година. По подразбиране отворената." };
const P_EMP = { type: "string", description: "id на служителя от read_schedule/get_employee_directory. Приема се и точно име или служебен номер." };
const P_SUMMARY = { type: "string", description: "Кратко обяснение какво и защо се променя — показва се на нарядчика в предпросмотъра." };

export const TOOL_DEFS: ToolDef[] = [
  // ── Четене ───────────────────────────────────────────────────────────────
  fn(
    "read_schedule",
    "Пълното състояние на графика: шапка, състав, попълнените клетки по дни и изчисленият итог на всеки служител (или повеските, ако module е \"reisi\"). Използвай го преди всеки анализ или предложение. Може да чете и месец, различен от отворения — само за четене.",
    {
      module: P_MODULE,
      month: P_MONTH,
      year: P_YEAR,
      includeCells: { type: "boolean", description: "Да включи ли попълнените клетки по дни. По подразбиране true." },
    },
  ),
  fn(
    "get_employee_directory",
    "Справочникът на бригадата — всички служители, независимо дали участват в текущия месец: служебен номер, име, длъжност, полагаем отпуск, дневна норма, базов шаблон и дали са в състава.",
  ),
  fn(
    "get_shift_codes",
    "Легендата: кодовете на смените (код, час на явка и освобождаване, продължителност, прекъсвания) и кодовете за отсъствие.",
  ),
  fn(
    "validate_schedule",
    "Пуска правния двигател по Наредба № 50 и връща нарушенията с член, служител и дата.",
    { module: P_MODULE, month: P_MONTH, year: P_YEAR },
  ),
  fn(
    "get_settings",
    "Общите настройки, които влияят на изчисленията: коефициент за приравняване на нощния труд, нощен интервал, седмичен максимум, коефициент за труд в празник, длъжности, поправки в производствения календар. Само за четене — асистентът няма право да ги променя.",
  ),

  // ── Промени в „Смени“ ────────────────────────────────────────────────────
  fn(
    "update_cell",
    "Предлага промяна в ЕДНА клетка от графика. При промени в няколко дни или за няколко служители ползвай bulk_update_cells — по-ефективно е.",
    {
      employee_id: P_EMP,
      date: { type: ["integer", "string"], description: 'Ден от месеца (1..31) или дата "2026-09-14".' },
      code: { type: ["string", "null"], description: 'Код от легендата ("3", "ДО"…) или null за изчистване на клетката.' },
      extension_approved: { type: "boolean", description: "Оформено удължаване по чл.14." },
      summary: P_SUMMARY,
    },
    ["employee_id", "date"],
  ),
  fn(
    "bulk_update_cells",
    "Предлага много промени в клетките наведнъж — отпуск за период, размяна между двама души, попълване на седмица, разстановка на доработки. ПРЕДПОЧИТАЙ този инструмент пред няколко последователни update_cell.",
    {
      summary: P_SUMMARY,
      clear_first: { type: "boolean", description: "Да изчисти ли целия месец на засегнатите служители преди прилагането (пълно преизчисляване)." },
      changes: {
        type: "array",
        description: "Списък с промените.",
        items: {
          type: "object",
          required: ["date"],
          properties: {
            employee_id: P_EMP,
            date: { type: ["integer", "string"], description: 'Ден от месеца (1..31) или дата "2026-09-14".' },
            code: { type: ["string", "null"], description: "Код от легендата или null за изчистване." },
            extension_approved: { type: "boolean", description: "Оформено удължаване по чл.14." },
          },
        },
      },
    },
    ["summary", "changes"],
  ),
  fn(
    "apply_shift_template",
    "Разстила базовия цикъл на ЕДИН служител върху месеца: „2 през 2“ (дневни смени) или редовна смяна пон.–пет. Отпуските и болничните в клетките се запазват. По подразбиране почивните дни се разпределят така, че часовете да излязат по норма.",
    {
      employee_id: P_EMP,
      template_type: {
        type: "string",
        enum: ["cycle2x2", "weekdays", "none"],
        description: 'Вид шаблон. Ако не е зададен, се ползва вече записаният шаблон на служителя. "none" изчиства разстановката по шаблон.',
      },
      codes: { type: "array", items: { type: "string" }, description: 'Кодове за цикъла, напр. ["1","2"]. По подразбиране кодът от шаблона на служителя.' },
      anchor: { type: "string", description: 'Опорна дата на цикъла "2026-09-01" — от нея се брои редуването.' },
      save_as_default: { type: "boolean", description: "Да запише ли шаблона в справочника, за да важи и за следващите месеци. По подразбиране false." },
      balance_to_norm: { type: "boolean", description: "Да разпредели ли почивни дни, докато часовете паднат до нормата. По подразбиране true." },
      month: P_MONTH,
      year: P_YEAR,
    },
    ["employee_id"],
  ),

  // ── Промени в „Рейси“ ────────────────────────────────────────────────────
  fn(
    "create_povesa",
    "Предлага нова повеска. Почивката в оборотния пункт се изчислява автоматично по чл.17 (не по-малко от 75% от времето „натам“), ако общото време надхвърля 12 ч.",
    {
      employee_id: P_EMP,
      date_out: { type: "string", description: 'Явка — "2026-09-14T06:30" или само дата (тогава 08:00).' },
      date_return: { type: "string", description: "Освобождаване в основния пункт — същият формат." },
      route_type: { type: "string", enum: ["вътрешен", "международен"], description: "Международният е интероперативен граничен превоз — важи по-строгият режим по чл.16а, 17а, 17б." },
      mode: { type: "string", enum: ["named", "callless", "oncall"], description: "Именен график, безизвикателна система или по извикване. По подразбиране named." },
      out_hours: { type: "number", description: 'Време "натам" в часове, ако е известно. Иначе се разпределя автоматично.' },
      rest_hours: { type: "number", description: "Почивка в оборотния пункт в часове, ако е зададена ръчно." },
      rest_room: { type: "boolean", description: "Има ли стая за отдих в оборотния пункт (чл.17). По подразбиране true." },
      route: { type: "string", description: "Направление/влак." },
      break_minutes: { type: "integer", description: "Почивка вътре в повеската в минути (чл.17б)." },
      second_driver: { type: "boolean", description: "Втори машинист — отпада почивката по чл.17б." },
      driving_out: { type: "number", description: "Време на управление „натам“ (часове) — за контрола по чл.17б." },
      driving_back: { type: "number", description: "Време на управление „обратно“ (часове)." },
      summary: P_SUMMARY,
    },
    ["employee_id", "date_out", "date_return"],
  ),
  fn(
    "update_povesa",
    "Предлага редакция на съществуваща повеска.",
    {
      povesa_id: { type: "string", description: "id на повеската от read_schedule с module \"reisi\"." },
      changes: {
        type: "object",
        description: "Полетата за промяна.",
        properties: {
          yavka: { type: "string" },
          release: { type: "string" },
          arrival_turnaround: { type: "string" },
          departure_turnaround: { type: "string" },
          rest_room: { type: "boolean" },
          international: { type: "boolean" },
          mode: { type: "string", enum: ["named", "callless", "oncall"] },
          extension_approved: { type: "boolean" },
          break_minutes: { type: "integer" },
          second_driver: { type: "boolean" },
          driving_out: { type: "number" },
          driving_back: { type: "number" },
          route: { type: "string" },
          note: { type: "string" },
        },
      },
      summary: P_SUMMARY,
    },
    ["povesa_id", "changes"],
  ),
  fn(
    "assign_next_trip",
    "Безизвикателна система: намира най-ранната допустима следваща явка за служителя според положената почивка след последната му повеска (чл.16, чл.16а, чл.17) и предлага повеска от този момент.",
    {
      employee_id: P_EMP,
      duration_hours: { type: "number", description: "Продължителност на новата повеска. По подразбиране — колкото последната." },
      route_type: { type: "string", enum: ["вътрешен", "международен"] },
      summary: P_SUMMARY,
    },
    ["employee_id"],
  ),

  // ── Служители ────────────────────────────────────────────────────────────
  fn(
    "add_employee",
    "Предлага нов служител в справочника на бригадата. След потвърждение той влиза и в състава на отворения месец.",
    {
      data: {
        type: "object",
        required: ["name"],
        properties: {
          service_no: { type: "string", description: "Служебен №." },
          name: { type: "string", description: "Име, презиме, фамилия." },
          position: { type: "string", description: "Длъжност — от списъка в get_settings." },
          annual_leave_days: { type: "integer", description: "Полагаем ДО в дни." },
          daily_norm: { type: "number", description: "Дневна норма в часове (8; при намалено работно време — по-малко)." },
        },
      },
      summary: P_SUMMARY,
    },
    ["data"],
  ),
  fn(
    "update_employee",
    "Предлага редакция на данните на служител в справочника.",
    {
      employee_id: P_EMP,
      changes: {
        type: "object",
        properties: {
          service_no: { type: "string" },
          name: { type: "string" },
          position: { type: "string" },
          annual_leave_days: { type: "integer" },
          daily_norm: { type: "number" },
          active: { type: "boolean", description: "false — изважда от състава за бъдещите месеци, без да го трие." },
        },
      },
      summary: P_SUMMARY,
    },
    ["employee_id", "changes"],
  ),
  fn(
    "remove_employee_from_month",
    "Изважда служителя от графика на КОНКРЕТНИЯ месец. Остава в справочника и в останалите месеци; клетките му се запазват и се възстановяват при връщане.",
    { employee_id: P_EMP, month: P_MONTH, year: P_YEAR, summary: P_SUMMARY },
    ["employee_id"],
  ),
  fn(
    "restore_employee_to_month",
    "Връща в графика на месеца служител, който е бил изваден.",
    { employee_id: P_EMP, month: P_MONTH, year: P_YEAR, summary: P_SUMMARY },
    ["employee_id"],
  ),
  fn(
    "delete_employee_permanently",
    "НЕОБРАТИМО изтриване от справочника и от ВСИЧКИ запазени месеци, включително клетките и повеските. Иска отделно, засилено потвърждение от нарядчика. Предлагай го само при изрично и недвусмислено искане; при „да го махна от графика“ ползвай remove_employee_from_month.",
    { employee_id: P_EMP, summary: P_SUMMARY },
    ["employee_id"],
  ),

  // ── Цял месец ────────────────────────────────────────────────────────────
  fn(
    "recalculate_month",
    "Преизчислява месеца: нормата се взема наново от производствения календар, а остатъкът (+/−) на всеки служител — от фактически записания предходен месец.",
    { module: P_MODULE, month: P_MONTH, year: P_YEAR, summary: P_SUMMARY },
  ),
  fn(
    "generate_full_month",
    "СЪСТАВЯ ЦЕЛИЯ ГРАФИК НАНОВО: разстила шаблона на всеки служител върху месеца и разпределя почивните дни така, че часовете да излязат по норма (с отчитане на пренесения остатък). Вече отбелязаните отпуски, болнични и командировки се запазват. Ръчните доработки остават за нарядчика. Нарядчикът вижда пълния списък на всички засегнати клетки преди прилагане.",
    { module: P_MODULE, month: P_MONTH, year: P_YEAR, summary: P_SUMMARY },
  ),

  // ── Шапка ────────────────────────────────────────────────────────────────
  fn(
    "propose_header_changes",
    "Предлага промени в шапката на графика (норма, наименования, подписи).",
    {
      summary: P_SUMMARY,
      header: {
        type: "object",
        properties: {
          organization: { type: "string" },
          department: { type: "string" },
          brigade: { type: "string" },
          normHours: { type: "number" },
        },
      },
    },
    ["summary", "header"],
  ),
];

export type ToolResult = { name: string; content: string };

// ─── Общи помощни ───────────────────────────────────────────────────────────

const J = (v: unknown) => JSON.stringify(v);
const err = (message: string) => J({ error: message });

/** Приема и snake_case, и camelCase — моделите бъркат двете. */
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function findEmployee(name?: string, id?: string) {
  const list = useApp.getState().employees;
  const roster = useApp.getState().roster;
  const pool: { id: string; name: string; serviceNo: string }[] = [
    ...list,
    ...roster.filter((r) => !list.some((e) => e.id === r.id)),
  ];
  if (!pool.length) return null;
  if (id) {
    const byId = pool.find((e) => e.id === id);
    if (byId) return byId;
  }
  const needle = (id ?? name)?.trim().toLowerCase();
  if (!needle) return null;
  return (
    pool.find((e) => e.name.toLowerCase() === needle) ??
    pool.find((e) => e.name.toLowerCase().includes(needle)) ??
    pool.find((e) => e.serviceNo.toLowerCase() === needle) ??
    null
  );
}

/** Ден от месеца от число, "14" или "2026-09-14". */
function dayOf(v: unknown, header: { year: number; month: number }): number | null {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (/^\d{1,2}$/.test(s)) return Number(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, y, mo, d] = m;
    if (Number(y) !== header.year || Number(mo) !== header.month) return null;
    return Number(d);
  }
  return null;
}

/** "2026-09-14T06:30" или "2026-09-14" → ISO. */
function moment(v: unknown, defaultHour = 8): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${String(defaultHour).padStart(2, "0")}:00` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type View = { schedule: ResolvedSchedule; trips: Trip[]; isOpen: boolean };

/** Изгледът за четене — отвореният месец или запазен друг месец от базата. */
async function readView(args: Record<string, unknown>): Promise<View | { error: string }> {
  const st = useApp.getState();
  const cur = resolved(st);
  const year = num(pick(args, "year"));
  const month = num(pick(args, "month"));

  if (!year || !month || (cur && cur.header.year === year && cur.header.month === month)) {
    if (!cur) return { error: "Няма зареден график." };
    return { schedule: cur, trips: st.tripBoard?.trips ?? [], isOpen: true };
  }

  const id = scheduleId(year, month);
  try {
    const raw = await db.loadSchedule(id);
    if (!raw) return { error: `Месец ${month}/${year} още не е откриван — няма какво да се прочете.` };
    const { participants: _p, ...rest } = raw;
    void _p;
    const board = await db.loadTrips(id);
    return {
      schedule: { ...rest, employees: resolveEmployees(raw, st.roster) },
      trips: board?.trips ?? [],
      isOpen: false,
    };
  } catch {
    return { error: `Хранилището не е достъпно — може да се чете само отвореният месец.` };
  }
}

/**
 * Проверките преди всяка промяна: има отворен график, месецът съвпада с
 * поискания и няма друго предложение, което да чака потвърждение (иначе
 * второто би изместило първото, без нарядчикът да го е видял).
 */
function writeTarget(args: Record<string, unknown>): { schedule: ResolvedSchedule } | { error: string } {
  const st = useApp.getState();
  const cur = resolved(st);
  if (!cur) return { error: "Няма зареден график." };

  const year = num(pick(args, "year"));
  const month = num(pick(args, "month"));
  if (year && month && (year !== cur.header.year || month !== cur.header.month)) {
    return {
      error:
        `Отворен е месец ${cur.header.month}/${cur.header.year}, а промяната е за ${month}/${year}. ` +
        "Промени се правят само в отворения месец — помоли нарядчика да отвори другия месец от лентата с месеците.",
    };
  }
  if (st.pendingPatch) {
    return {
      error:
        "Има предложение, което още чака потвърждение от нарядчика. Изчакай той да натисне „Приложи“ или „Откажи“ и чак тогава предлагай следващата промяна.",
    };
  }
  return { schedule: cur };
}

function awaiting(extra: Record<string, unknown>): string {
  return J({
    applied: false,
    awaitingConfirmation: true,
    message:
      "Предложението е показано на нарядчика като предпросмотър „беше → ще стане“ и чака потвърждение. Не твърди, че промяната вече е направена.",
    ...extra,
  });
}

/** Как се нарича човекът в текстовете: име, иначе служебен №, иначе id. */
function labelOf(e: { name?: string; serviceNo?: string; id: string }): string {
  const n = (e.name ?? "").trim();
  if (n) return n;
  if ((e.serviceNo ?? "").trim()) return `служ. № ${e.serviceNo}`;
  return `(без име, id ${e.id})`;
}

const nameOf = (schedule: ResolvedSchedule, id: string) =>
  schedule.employees.find((e) => e.id === id)?.name ||
  useApp.getState().roster.find((r) => r.id === id)?.name ||
  id;

const codeOf = (id?: string) =>
  useApp.getState().settings.codes.find((c) => c.id === id)?.code ?? "—";

// ─── Клетки ─────────────────────────────────────────────────────────────────

/** Съставя списък с промени по клетки от заявката на модела. */
function buildCellChanges(
  raw: Array<Record<string, unknown>>,
  schedule: ResolvedSchedule,
  clearFirst: boolean,
): { changes: CellChange[]; problems: string[] } {
  const settings = useApp.getState().settings;
  const changes: CellChange[] = [];
  const problems: string[] = [];
  const dim = daysInMonth(schedule.header.year, schedule.header.month);

  if (clearFirst) {
    const touched = new Set<string>();
    for (const ch of raw) {
      const emp = findEmployee(pick(ch, "employee_name", "employeeName") as string, pick(ch, "employee_id", "employeeId") as string);
      if (emp) touched.add(emp.id);
    }
    for (const empId of touched) {
      for (let d = 1; d <= dim; d++) {
        if (schedule.cells[empId]?.[d]) {
          changes.push({ employeeId: empId, day: d, from: schedule.cells[empId][d], to: null });
        }
      }
    }
  }

  for (const ch of raw) {
    const emp = findEmployee(pick(ch, "employee_name", "employeeName") as string, pick(ch, "employee_id", "employeeId") as string);
    if (!emp) {
      problems.push(`Не е намерен служител: ${pick(ch, "employee_name", "employeeName", "employee_id", "employeeId") ?? "(непосочен)"}`);
      continue;
    }
    const day = dayOf(pick(ch, "date", "day"), schedule.header);
    if (!day || day < 1 || day > dim) {
      problems.push(
        `Датата ${String(pick(ch, "date", "day"))} за ${labelOf(emp)} е извън отворения месец ` +
          `${schedule.header.month}/${schedule.header.year} или не е разпозната.`,
      );
      continue;
    }
    const from = schedule.cells[emp.id]?.[day] ?? null;
    const codeStr = pick(ch, "code");
    const ext = pick(ch, "extension_approved", "extensionApproved");

    if (codeStr === undefined || ch.code === null) {
      changes.push({ employeeId: emp.id, day, from, to: null });
      continue;
    }
    const code = settings.codes.find((c) => c.code.toLowerCase() === String(codeStr).toLowerCase());
    if (!code) {
      problems.push(`Няма код "${String(codeStr)}" в легендата`);
      continue;
    }
    changes.push({
      employeeId: emp.id,
      day,
      from,
      to: { codeId: code.id, ...(ext !== undefined ? { extension: { approved: Boolean(ext) } } : {}) },
    });
  }

  const effective = changes.filter(
    (c) =>
      (c.from?.codeId ?? null) !== (c.to?.codeId ?? null) ||
      c.to?.extension?.approved !== c.from?.extension?.approved,
  );
  return { changes: effective, problems };
}

function cellPreview(schedule: ResolvedSchedule, changes: CellChange[]) {
  return changes.slice(0, 40).map((c) => ({
    employee: nameOf(schedule, c.employeeId),
    day: c.day,
    from: codeOf(c.from?.codeId),
    to: codeOf(c.to?.codeId),
  }));
}

// ─── Разстановка по шаблон ──────────────────────────────────────────────────

/**
 * Желаната разстановка на един служител по шаблон. Клетките, които не са
 * работни (отпуск, болничен, командировка, неявка), се пазят такива, каквито
 * са — шаблонът не бива да заличава оформено отсъствие.
 */
function rowFromPattern(
  pattern: ShiftPattern | undefined,
  existing: Record<number, Cell>,
  header: Pick<ScheduleHeader, "year" | "month">,
): Record<number, Cell> {
  const settings = useApp.getState().settings;
  const dim = daysInMonth(header.year, header.month);
  const target = patternMonth(pattern, header.year, header.month);
  const out: Record<number, Cell> = {};

  for (let d = 1; d <= dim; d++) {
    const cur = existing[d];
    const curCode = cur ? findCode(settings, cur.codeId) : null;
    if (curCode && curCode.category !== "work") {
      out[d] = cur!; // оформено отсъствие — остава
      continue;
    }
    const codeId = target[d];
    if (codeId) out[d] = { codeId };
  }
  return out;
}

/**
 * Маха работни дни, докато часовете паднат до нормата (с пренесения остатък).
 * Дните за махане се разпределят равномерно по месеца, а не се режат от края —
 * иначе накрая би се получил един дълъг блок почивка.
 */
function balanceToNorm(
  row: Record<number, Cell>,
  employee: Employee,
  header: ScheduleHeader,
): { row: Record<number, Cell>; removed: number[]; carryAfter: number } {
  const settings = useApp.getState().settings;
  const totals = () => calcEmployee({ header, cells: { [employee.id]: row } }, employee, settings);

  const candidates = Object.keys(row)
    .map(Number)
    .sort((a, b) => a - b)
    .map((d) => {
      const c = calcCell(row[d], d, employee, settings, header);
      const contrib = c.workHours + (c.nightHours * settings.nightFactor - c.nightHours);
      return { day: d, contrib, work: c.code?.category === "work" };
    })
    .filter((x) => x.work && x.contrib > 0);

  let surplus = totals().carryForward;
  if (surplus <= 0 || !candidates.length) return { row, removed: [], carryAfter: surplus };

  // Колко дни се събират в излишъка: денят се маха, ако поне половината от
  // него е над нормата — така крайният баланс е най-близо до нулата.
  let left = surplus;
  let count = 0;
  for (let i = candidates.length - 1; i >= 0 && left > 0; i--) {
    if (left >= candidates[i].contrib * 0.5) {
      left -= candidates[i].contrib;
      count++;
    }
  }
  if (!count) return { row, removed: [], carryAfter: surplus };

  const removed: number[] = [];
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx = Math.min(candidates.length - 1, Math.round(((i + 0.5) * candidates.length) / count));
    while (picked.has(idx) && idx > 0) idx--;
    while (picked.has(idx) && idx < candidates.length - 1) idx++;
    if (picked.has(idx)) continue;
    picked.add(idx);
    removed.push(candidates[idx].day);
  }

  const next = { ...row };
  for (const d of removed) delete next[d];
  row = next;
  surplus = totals().carryForward;
  return { row, removed: removed.sort((a, b) => a - b), carryAfter: surplus };
}

/** Разликата между желания и текущия ред — само реалните промени. */
function diffRow(
  employeeId: string,
  desired: Record<number, Cell>,
  existing: Record<number, Cell>,
  dim: number,
): CellChange[] {
  const out: CellChange[] = [];
  for (let d = 1; d <= dim; d++) {
    const from = existing[d] ?? null;
    const to = desired[d] ?? null;
    if ((from?.codeId ?? null) === (to?.codeId ?? null)) continue;
    out.push({ employeeId, day: d, from, to });
  }
  return out;
}

// ─── Повески ────────────────────────────────────────────────────────────────

/**
 * Разпределя повеската на „натам — почивка в оборота — обратно“ по чл.17.
 * При общо време до 12 ч. почивка може да не се предоставя и повеската остава
 * една част. Над 12 ч. се търси почивка от 75% от времето „натам“ — с равни
 * рамена излиза span = 2t + 0,75t, откъдето t = span / 2,75.
 */
function splitTrip(
  yavka: string,
  release: string,
  opts: { outHours?: number; restHours?: number },
): { arrival?: string; departure?: string; note: string } {
  const span = hoursBetween(yavka, release);
  if (opts.outHours || opts.restHours) {
    const out = opts.outHours ?? (span - (opts.restHours ?? 0)) / 2;
    const rest = opts.restHours ?? Math.max(0, span - 2 * out);
    if (out <= 0 || out * 2 + rest > span + 0.01) {
      return { note: "Зададените времена не се побират в повеската — оставена е без престой в оборота." };
    }
    return {
      arrival: new Date(new Date(yavka).getTime() + out * 3600000).toISOString(),
      departure: new Date(new Date(yavka).getTime() + (out + rest) * 3600000).toISOString(),
      note: `Зададени ръчно: „натам“ ${formatHours(out)} ч., почивка в оборота ${formatHours(rest)} ч.`,
    };
  }
  if (span <= 12) {
    return {
      note: `Общо ${formatHours(span)} ч. — до 12 ч. по чл.17 почивка в оборотния пункт може да не се предоставя.`,
    };
  }
  const t = span / 2.75;
  const rest = span - 2 * t;
  return {
    arrival: new Date(new Date(yavka).getTime() + t * 3600000).toISOString(),
    departure: new Date(new Date(yavka).getTime() + (t + rest) * 3600000).toISOString(),
    note:
      `Общо ${formatHours(span)} ч.: „натам“ ${formatHours(t)} ч., почивка в оборота ` +
      `${formatHours(rest)} ч. (75% от времето „натам“ по чл.17), „обратно“ ${formatHours(t)} ч.`,
  };
}

function tripDetails(trip: Trip): string[] {
  const settings = useApp.getState().settings;
  const c = calcTrip(trip, settings);
  return [
    `Явка: ${formatDateTimeBG(trip.yavka)}`,
    ...(trip.arrivalTurnaround ? [`Пристигане в оборота: ${formatDateTimeBG(trip.arrivalTurnaround)}`] : []),
    ...(trip.departureTurnaround ? [`Отправяне обратно: ${formatDateTimeBG(trip.departureTurnaround)}`] : []),
    `Освобождаване: ${formatDateTimeBG(trip.release)}`,
    `Работно време ${formatHours(c.workHours)} ч., от тях нощни ${formatHours(c.nightHours)} ч.`,
    ...(c.turnaroundHours !== null ? [`Престой в оборота ${formatHours(c.turnaroundHours)} ч. — ${c.turnaroundIsWork ? "отчита се като работно време" : "почивка"}`] : []),
  ];
}

// ─── Изпълнение ─────────────────────────────────────────────────────────────

/** Старите имена на инструменти остават работещи. */
const ALIASES: Record<string, string> = {
  get_schedule: "read_schedule",
  get_codes: "get_shift_codes",
  get_validation: "validate_schedule",
  propose_cell_changes: "bulk_update_cells",
};

/** Изпълнява едно извикване на инструмент върху текущото състояние. */
export async function runTool(rawName: string, args: Record<string, unknown>): Promise<string> {
  const name = ALIASES[rawName] ?? rawName;
  const st = useApp.getState();
  const { settings, roster } = st;

  switch (name) {
    // ── Четене ────────────────────────────────────────────────────────────
    case "read_schedule": {
      const view = await readView(args);
      if ("error" in view) return err(view.error);
      const { schedule, trips, isOpen } = view;

      if (pick(args, "module") === "reisi") {
        const v = validateTrips(trips, schedule.employees, settings);
        return J({
          month: `${schedule.header.month}/${schedule.header.year}`,
          isOpenMonth: isOpen,
          trips: trips.map((t) => {
            const c = calcTrip(t, settings);
            return {
              id: t.id,
              employeeId: t.employeeId,
              employee: nameOf(schedule, t.employeeId),
              mode: t.mode,
              international: t.international,
              yavka: t.yavka,
              arrivalTurnaround: t.arrivalTurnaround,
              departureTurnaround: t.departureTurnaround,
              release: t.release,
              outHours: c.outHours,
              turnaroundHours: c.turnaroundHours,
              backHours: c.backHours,
              workHours: +c.workHours.toFixed(2),
              nightHours: +c.nightHours.toFixed(2),
              restRoom: t.restRoom,
              route: t.route,
            };
          }),
          violations: v.map((x) => ({ severity: x.severity, article: x.article, message: x.message, employee: nameOf(schedule, x.employeeId ?? ""), tripId: x.tripId })),
        });
      }

      const includeCells = pick(args, "includeCells", "include_cells") !== false;
      const totals = calcAll(schedule, settings);
      const dim = daysInMonth(schedule.header.year, schedule.header.month);
      return J({
        header: schedule.header,
        status: schedule.status,
        isOpenMonth: isOpen,
        daysInMonth: dim,
        calendarWorkingDays: countWorkingDays(schedule.header.year, schedule.header.month),
        rosterNotInThisMonth: roster
          .filter((r) => !schedule.employees.some((e) => e.id === r.id))
          .map((r) => ({ id: r.id, name: r.name, position: r.position, active: r.active })),
        weekdays: Object.fromEntries(
          Array.from({ length: dim }, (_, i) => [i + 1, weekdayName(schedule.header.year, schedule.header.month, i + 1)]),
        ),
        employees: schedule.employees.map((e) => {
          const t = totals[e.id];
          const row = schedule.cells[e.id] ?? {};
          const cells = includeCells
            ? Object.fromEntries(
                Object.entries(row).map(([d, c]) => [d, settings.codes.find((x) => x.id === c.codeId)?.code ?? "?"]),
              )
            : undefined;
          return {
            id: e.id,
            serviceNo: e.serviceNo,
            name: e.name,
            position: e.position,
            dailyNorm: e.dailyNorm,
            annualLeaveDays: e.annualLeaveDays,
            carryOver: e.carryOver,
            /** Базов шаблон на смените (D.2.1) — черновата, върху която се работи. */
            shablon: describePattern(e.pattern, settings),
            /**
             * Ако е попълнено: отрицателният остатък идва от ползван отпуск в
             * посочения месец и трябва да се покрие с доработки (кодове 4–9).
             */
            dorabotkaSledOtpusk: e.carryOverReason
              ? {
                  otMesec: e.carryOverReason.fromMonth,
                  chasove: +e.carryOverReason.hours.toFixed(2),
                  dniOtpusk: e.carryOverReason.leaveDays,
                }
              : null,
            acknowledged: e.acknowledged,
            cells,
            totals: {
              rabotniDni: t.workDays,
              otraboteni: +t.worked.toFixed(2),
              nostenTrud: +t.night.toFixed(2),
              priravnenNostenTrud: +t.nightEqualized.toFixed(2),
              trudVPraznik: +t.holidayHours.toFixed(2),
              polzvanOtpusk: +t.leave.toFixed(2),
              polzvanMO: +t.sick.toFixed(2),
              obshtoChasove: +t.total.toFixed(2),
              norma: +t.norm.toFixed(2),
              razlikaZaMeseca: +t.diff.toFixed(2),
              ostatakZaSledvashtMesec: +t.carryForward.toFixed(2),
            },
          };
        }),
      });
    }

    case "get_employee_directory": {
      const inMonth = new Set(st.employees.map((e) => e.id));
      return J(
        roster.map((r) => ({
          id: r.id,
          serviceNo: r.serviceNo,
          name: r.name,
          position: r.position,
          annualLeaveDays: r.annualLeaveDays,
          dailyNorm: r.dailyNorm,
          active: r.active,
          uchastvaVMeseca: inMonth.has(r.id),
          shablon: describePattern(r.pattern, settings),
          note: r.note,
        })),
      );
    }

    case "get_shift_codes":
      return J(
        settings.codes.map((c) => {
          const span = c.start && c.end ? spanMinutes(c.start, c.end) : 0;
          return {
            code: c.code,
            label: c.label,
            category: c.category,
            start: c.start,
            end: c.end,
            hours: c.hours,
            prodalzhitelnost: span ? +((span - breaksMinutes(c.breaks)) / 60).toFixed(2) : undefined,
            breaks: c.breaks,
          };
        }),
      );

    case "validate_schedule": {
      const view = await readView(args);
      if ("error" in view) return err(view.error);
      const { schedule, trips } = view;
      const module = pick(args, "module");
      const out: Record<string, unknown> = { month: `${schedule.header.month}/${schedule.header.year}` };

      if (module !== "reisi") {
        out.smeni = validateSchedule(schedule, settings).map((x) => ({
          severity: x.severity,
          article: x.article,
          message: x.message,
          employee: x.employeeId ? nameOf(schedule, x.employeeId) : undefined,
          employeeId: x.employeeId,
          day: x.day,
        }));
      }
      if (module !== "smeni") {
        out.reisi = validateTrips(trips, schedule.employees, settings).map((x) => ({
          severity: x.severity,
          article: x.article,
          message: x.message,
          employee: x.employeeId ? nameOf(schedule, x.employeeId) : undefined,
          tripId: x.tripId,
        }));
      }
      return J(out);
    }

    case "get_settings":
      return J({
        nightFactor: settings.nightFactor,
        nightStart: settings.nightStart,
        nightEnd: settings.nightEnd,
        weeklyMaxHours: settings.weeklyMaxHours,
        holidayPayFactor: settings.holidayPayFactor,
        positions: settings.positions,
        holidayOverrides: Object.fromEntries(
          Object.entries(settings.holidays ?? {}).map(([y, list]) => [y, list.length]),
        ),
        note: "Само за четене. Асистентът няма право да променя общите настройки — това се прави от нарядчика в раздел „Настройки“.",
      });

    // ── Клетки ────────────────────────────────────────────────────────────
    case "update_cell":
    case "bulk_update_cells": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const schedule = target.schedule;

      const raw =
        name === "update_cell"
          ? [args]
          : ((pick(args, "changes") ?? []) as Array<Record<string, unknown>>);
      const clearFirst = Boolean(pick(args, "clear_first", "clearFirst"));
      const { changes, problems } = buildCellChanges(raw, schedule, clearFirst);

      if (!changes.length) {
        return J({ applied: false, message: "Няма реални промени за прилагане.", problems });
      }

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "Промени в графика"),
        cells: changes,
        source: "ai",
      });
      return awaiting({ changeCount: changes.length, problems, preview: cellPreview(schedule, changes) });
    }

    case "apply_shift_template": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const schedule = target.schedule;

      const emp = findEmployee(pick(args, "employee_name") as string, pick(args, "employee_id", "employeeId") as string);
      if (!emp) return err("Не е намерен такъв служител.");
      const employee = schedule.employees.find((e) => e.id === emp.id);
      if (!employee) return err(`${labelOf(emp)} не участва в този месец. Върни го с restore_employee_to_month.`);

      const rosterEntry = roster.find((r) => r.id === emp.id);
      const kind = pick(args, "template_type", "templateType") as ShiftPattern["kind"] | undefined;
      const anchor =
        (pick(args, "anchor") as string) ??
        (rosterEntry?.pattern && rosterEntry.pattern.kind === "cycle2x2" ? rosterEntry.pattern.anchor : undefined) ??
        `${schedule.header.year}-${String(schedule.header.month).padStart(2, "0")}-01`;

      let pattern: ShiftPattern | undefined;
      if (kind) {
        pattern = defaultPattern(kind, settings, anchor);
        const codes = pick(args, "codes") as string[] | undefined;
        if (codes?.length && pattern.kind === "cycle2x2") {
          const ids = codes
            .map((c) => settings.codes.find((x) => x.code.toLowerCase() === String(c).toLowerCase())?.id)
            .filter((x): x is string => Boolean(x));
          if (!ids.length) return err(`Няма такива кодове в легендата: ${codes.join(", ")}`);
          pattern = { ...pattern, codeIds: ids };
        } else if (codes?.length && pattern.kind === "weekdays") {
          const id = settings.codes.find((x) => x.code.toLowerCase() === String(codes[0]).toLowerCase())?.id;
          if (id) pattern = { kind: "weekdays", codeId: id };
        }
      } else {
        pattern = rosterEntry?.pattern;
        if (!pattern || pattern.kind === "none") {
          return err(`${labelOf(emp)} няма записан базов шаблон. Задай template_type ("cycle2x2" или "weekdays").`);
        }
      }

      const dim = daysInMonth(schedule.header.year, schedule.header.month);
      const existing = schedule.cells[emp.id] ?? {};
      let desired = rowFromPattern(pattern, existing, schedule.header);
      let removed: number[] = [];
      let carryAfter = 0;
      if (pick(args, "balance_to_norm", "balanceToNorm") !== false) {
        const b = balanceToNorm(desired, employee, schedule.header);
        desired = b.row;
        removed = b.removed;
        carryAfter = b.carryAfter;
      }

      const changes = diffRow(emp.id, desired, existing, dim);
      const ops: PatchOp[] =
        pick(args, "save_as_default", "saveAsDefault") === true && pattern
          ? [
              {
                kind: "roster.update",
                label: `${labelOf(emp)}: базовият шаблон в справочника става „${describePattern(pattern, settings)}“`,
                employeeId: emp.id,
                changes: { pattern },
              },
            ]
          : [];

      if (!changes.length && !ops.length) {
        return J({ applied: false, message: "Разстановката по този шаблон вече е налице — няма какво да се смени." });
      }

      st.proposePatch({
        summary:
          String(pick(args, "summary") ?? "") ||
          `${labelOf(emp)}: разстановка по шаблон „${describePattern(pattern, settings)}“`,
        cells: changes,
        ops,
        source: "ai",
      });
      return awaiting({
        employee: labelOf(emp),
        shablon: describePattern(pattern, settings),
        changeCount: changes.length,
        pochivniPoNorma: removed,
        ostatakSledTova: +carryAfter.toFixed(2),
        preview: cellPreview(schedule, changes),
      });
    }

    // ── Повески ───────────────────────────────────────────────────────────
    case "create_povesa": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const schedule = target.schedule;

      const emp = findEmployee(pick(args, "employee_name") as string, pick(args, "employee_id", "employeeId") as string);
      if (!emp) return err("Не е намерен такъв служител.");
      if (!schedule.employees.some((e) => e.id === emp.id)) {
        return err(`${labelOf(emp)} не участва в този месец.`);
      }

      const yavka = moment(pick(args, "date_out", "dateOut", "yavka"), 8);
      const release = moment(pick(args, "date_return", "dateReturn", "release"), 20);
      if (!yavka || !release) return err('Невалидни дати. Формат: "2026-09-14T06:30".');
      if (new Date(release) <= new Date(yavka)) return err("Освобождаването трябва да е след явката.");

      const international = String(pick(args, "route_type", "routeType") ?? "").toLowerCase().startsWith("меж");
      const split = splitTrip(yavka, release, {
        outHours: num(pick(args, "out_hours", "outHours")),
        restHours: num(pick(args, "rest_hours", "restHours")),
      });

      const trip: Trip = {
        id: `t${Date.now().toString(36)}`,
        employeeId: emp.id,
        mode: (pick(args, "mode") as TripMode) ?? "named",
        international,
        yavka,
        ...(split.arrival ? { arrivalTurnaround: split.arrival } : {}),
        ...(split.departure ? { departureTurnaround: split.departure } : {}),
        release,
        restRoom: pick(args, "rest_room", "restRoom") !== false,
        ...(num(pick(args, "break_minutes", "breakMinutes")) !== undefined ? { breakMinutes: num(pick(args, "break_minutes", "breakMinutes")) } : {}),
        ...(pick(args, "second_driver", "secondDriver") !== undefined ? { secondDriver: Boolean(pick(args, "second_driver", "secondDriver")) } : {}),
        ...(num(pick(args, "driving_out", "drivingOut")) !== undefined ? { drivingOut: num(pick(args, "driving_out", "drivingOut")) } : {}),
        ...(num(pick(args, "driving_back", "drivingBack")) !== undefined ? { drivingBack: num(pick(args, "driving_back", "drivingBack")) } : {}),
        ...(pick(args, "route") ? { route: String(pick(args, "route")) } : {}),
      };

      const check = validateTrips([...(st.tripBoard?.trips ?? []), trip], schedule.employees, settings)
        .filter((v) => v.tripId === trip.id);

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "") || `Нова повеска за ${labelOf(emp)}`,
        cells: [],
        ops: [
          {
            kind: "trip.create",
            label: `Нова ${international ? "международна" : "вътрешна"} повеска за ${labelOf(emp)}`,
            details: [...tripDetails(trip), split.note],
            trip,
          },
        ],
        source: "ai",
      });
      return awaiting({
        employee: labelOf(emp),
        raztchet: split.note,
        povesa: { yavka: trip.yavka, arrivalTurnaround: trip.arrivalTurnaround, departureTurnaround: trip.departureTurnaround, release: trip.release },
        narusheniya: check.map((v) => ({ severity: v.severity, article: v.article, message: v.message })),
      });
    }

    case "update_povesa": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const id = String(pick(args, "povesa_id", "povesaId", "trip_id", "tripId") ?? "");
      const trip = (st.tripBoard?.trips ?? []).find((t) => t.id === id);
      if (!trip) return err(`Няма повеска с id ${id}.`);

      const ch = (pick(args, "changes") ?? {}) as Record<string, unknown>;
      const changes: Partial<Trip> = {};
      const details: string[] = [];
      const setMoment = (key: "yavka" | "release" | "arrivalTurnaround" | "departureTurnaround", raw: unknown, label: string) => {
        if (raw === undefined) return;
        const iso = moment(raw);
        if (!iso) { details.push(`⚠ Невалидна дата за ${label} — пропусната.`); return; }
        changes[key] = iso;
        details.push(`${label}: ${trip[key] ? formatDateTimeBG(trip[key]!) : "—"} → ${formatDateTimeBG(iso)}`);
      };
      setMoment("yavka", pick(ch, "yavka"), "Явка");
      setMoment("release", pick(ch, "release"), "Освобождаване");
      setMoment("arrivalTurnaround", pick(ch, "arrival_turnaround", "arrivalTurnaround"), "Пристигане в оборота");
      setMoment("departureTurnaround", pick(ch, "departure_turnaround", "departureTurnaround"), "Отправяне обратно");

      const flag = (key: "restRoom" | "international" | "secondDriver", raw: unknown, label: string) => {
        if (raw === undefined) return;
        changes[key] = Boolean(raw);
        details.push(`${label}: ${trip[key] ? "да" : "не"} → ${raw ? "да" : "не"}`);
      };
      flag("restRoom", pick(ch, "rest_room", "restRoom"), "Стая за отдих");
      flag("international", pick(ch, "international"), "Международна");
      flag("secondDriver", pick(ch, "second_driver", "secondDriver"), "Втори машинист");

      const numeric = (key: "breakMinutes" | "drivingOut" | "drivingBack", raw: unknown, label: string) => {
        const n = num(raw);
        if (n === undefined) return;
        changes[key] = n;
        details.push(`${label}: ${trip[key] ?? "—"} → ${n}`);
      };
      numeric("breakMinutes", pick(ch, "break_minutes", "breakMinutes"), "Почивка в повеската (мин.)");
      numeric("drivingOut", pick(ch, "driving_out", "drivingOut"), "Управление „натам“ (ч.)");
      numeric("drivingBack", pick(ch, "driving_back", "drivingBack"), "Управление „обратно“ (ч.)");

      if (pick(ch, "mode")) { changes.mode = pick(ch, "mode") as TripMode; details.push(`Режим: ${trip.mode} → ${changes.mode}`); }
      if (pick(ch, "route")) { changes.route = String(pick(ch, "route")); details.push(`Направление: ${trip.route ?? "—"} → ${changes.route}`); }
      if (pick(ch, "note")) { changes.note = String(pick(ch, "note")); }
      const ext = pick(ch, "extension_approved", "extensionApproved");
      if (ext !== undefined) {
        changes.extension = { approved: Boolean(ext) };
        details.push(`Удължаване по чл.14: ${trip.extension?.approved ? "оформено" : "не"} → ${ext ? "оформено" : "не"}`);
      }

      if (!Object.keys(changes).length) return J({ applied: false, message: "Няма разпознати промени в повеската." });

      const next = { ...trip, ...changes };
      const check = validateTrips(
        (st.tripBoard?.trips ?? []).map((t) => (t.id === id ? next : t)),
        schedule_employees(),
        settings,
      ).filter((v) => v.tripId === id);

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "") || `Редакция на повеска на ${nameOf(target.schedule, trip.employeeId)}`,
        cells: [],
        ops: [{ kind: "trip.update", label: `Повеска на ${nameOf(target.schedule, trip.employeeId)}`, details, tripId: id, changes }],
        source: "ai",
      });
      return awaiting({ changed: details, narusheniya: check.map((v) => ({ severity: v.severity, article: v.article, message: v.message })) });
    }

    case "assign_next_trip": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const schedule = target.schedule;

      const emp = findEmployee(pick(args, "employee_name") as string, pick(args, "employee_id", "employeeId") as string);
      if (!emp) return err("Не е намерен такъв служител.");

      const mine = (st.tripBoard?.trips ?? [])
        .filter((t) => t.employeeId === emp.id)
        .sort((a, b) => a.release.localeCompare(b.release));
      const last = mine[mine.length - 1];
      if (!last) {
        return err(
          `${labelOf(emp)} няма предходна повеска в този месец — няма от какво да се брои почивката. Задай явката изрично с create_povesa.`,
        );
      }

      const next = nextAllowedYavka(last, settings);
      const duration = num(pick(args, "duration_hours", "durationHours")) ?? hoursBetween(last.yavka, last.release);
      const release = new Date(new Date(next.iso).getTime() + duration * 3600000).toISOString();
      const international =
        pick(args, "route_type", "routeType") !== undefined
          ? String(pick(args, "route_type", "routeType")).toLowerCase().startsWith("меж")
          : last.international;
      const split = splitTrip(next.iso, release, {});

      const trip: Trip = {
        id: `t${Date.now().toString(36)}`,
        employeeId: emp.id,
        mode: "callless",
        international,
        yavka: next.iso,
        ...(split.arrival ? { arrivalTurnaround: split.arrival } : {}),
        ...(split.departure ? { departureTurnaround: split.departure } : {}),
        release,
        restRoom: last.restRoom,
        ...(last.route ? { route: last.route } : {}),
      };

      st.proposePatch({
        summary: `Безизвикателна система: следваща повеска за ${labelOf(emp)}`,
        cells: [],
        ops: [
          {
            kind: "trip.create",
            label: `Следваща повеска за ${labelOf(emp)} — най-ранна допустима явка ${formatDateTimeBG(next.iso)}`,
            details: [
              `Почивка след предходната повеска: ${formatHours(next.restHours)} ч. — ${next.reason}`,
              ...tripDetails(trip),
              split.note,
            ],
            trip,
          },
        ],
        source: "ai",
      });
      return awaiting({
        employee: labelOf(emp),
        predhodnaPovesa: { release: last.release },
        najRannaYavka: next.iso,
        pochivka: `${formatHours(next.restHours)} ч. — ${next.reason}`,
        novaPovesa: { yavka: trip.yavka, release: trip.release },
      });
    }

    // ── Служители ─────────────────────────────────────────────────────────
    case "add_employee": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const d = (pick(args, "data") ?? args) as Record<string, unknown>;
      const nameStr = String(pick(d, "name") ?? "").trim();
      if (!nameStr) return err("Липсва име на служителя.");

      const data: Partial<RosterEmployee> = {
        name: nameStr,
        serviceNo: String(pick(d, "service_no", "serviceNo") ?? ""),
        position: String(pick(d, "position") ?? settings.positions[0] ?? ""),
        annualLeaveDays: num(pick(d, "annual_leave_days", "annualLeaveDays")) ?? 20,
        dailyNorm: num(pick(d, "daily_norm", "dailyNorm")) ?? 8,
        active: true,
      };

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "") || `Нов служител: ${nameStr}`,
        cells: [],
        ops: [
          {
            kind: "roster.add",
            label: `Нов служител в справочника: ${nameStr}`,
            details: [
              `Служ. №: ${data.serviceNo || "—"}`,
              `Длъжност: ${data.position}`,
              `Полагаем ДО: ${data.annualLeaveDays} дни`,
              `Дневна норма: ${data.dailyNorm} ч.`,
              `Влиза и в състава на ${target.schedule.header.month}/${target.schedule.header.year}.`,
            ],
            data,
          },
        ],
        source: "ai",
      });
      return awaiting({ employee: nameStr, data });
    }

    case "update_employee": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const emp = findEmployee(pick(args, "employee_name") as string, pick(args, "employee_id", "employeeId") as string);
      if (!emp) return err("Не е намерен такъв служител.");
      const cur = roster.find((r) => r.id === emp.id);
      if (!cur) return err("Служителят го няма в справочника.");

      const ch = (pick(args, "changes") ?? {}) as Record<string, unknown>;
      const changes: Partial<RosterEmployee> = {};
      const details: string[] = [];
      const put = <K extends keyof RosterEmployee>(key: K, value: RosterEmployee[K] | undefined, label: string) => {
        if (value === undefined || value === cur[key]) return;
        changes[key] = value;
        const was = String(cur[key] ?? "").trim() || "—";
        details.push(`${label}: ${was} → ${String(value)}`);
      };
      put("name", pick(ch, "name") as string | undefined, "Име");
      put("serviceNo", pick(ch, "service_no", "serviceNo") as string | undefined, "Служ. №");
      put("position", pick(ch, "position") as string | undefined, "Длъжност");
      put("annualLeaveDays", num(pick(ch, "annual_leave_days", "annualLeaveDays")), "Полагаем ДО (дни)");
      put("dailyNorm", num(pick(ch, "daily_norm", "dailyNorm")), "Дневна норма (ч.)");
      if (ch.active !== undefined) put("active", Boolean(ch.active), "В състава");

      if (!Object.keys(changes).length) return J({ applied: false, message: "Няма разпознати промени по служителя." });

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "") || `Редакция на данните на ${labelOf(cur)}`,
        cells: [],
        ops: [{ kind: "roster.update", label: `Данни на ${labelOf(cur)}`, details, employeeId: emp.id, changes }],
        source: "ai",
      });
      return awaiting({ employee: labelOf(cur), changed: details });
    }

    case "remove_employee_from_month":
    case "restore_employee_to_month": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const schedule = target.schedule;
      const emp = findEmployee(pick(args, "employee_name") as string, pick(args, "employee_id", "employeeId") as string);
      if (!emp) return err("Не е намерен такъв служител.");
      const period = `${schedule.header.month}/${schedule.header.year}`;
      const inMonth = schedule.employees.some((e) => e.id === emp.id);

      if (name === "remove_employee_from_month") {
        if (!inMonth) return J({ applied: false, message: `${labelOf(emp)} и без това не участва в ${period}.` });
        st.proposePatch({
          summary: String(pick(args, "summary") ?? "") || `${labelOf(emp)} излиза от графика за ${period}`,
          cells: [],
          ops: [
            {
              kind: "month.remove",
              label: `${labelOf(emp)} се изважда от графика за ${period}`,
              details: [
                "Остава в справочника и в останалите месеци.",
                "Клетките му се запазват и се възстановяват, ако бъде върнат.",
              ],
              employeeId: emp.id,
            },
          ],
          source: "ai",
        });
      } else {
        if (inMonth) return J({ applied: false, message: `${labelOf(emp)} вече участва в ${period}.` });
        st.proposePatch({
          summary: String(pick(args, "summary") ?? "") || `${labelOf(emp)} се връща в графика за ${period}`,
          cells: [],
          ops: [
            {
              kind: "month.restore",
              label: `${labelOf(emp)} се връща в графика за ${period}`,
              details: ["Разстановката му се възстановява; остатъкът от предходния месец се дочита автоматично."],
              employeeId: emp.id,
            },
          ],
          source: "ai",
        });
      }
      return awaiting({ employee: labelOf(emp), month: period });
    }

    case "delete_employee_permanently": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const emp = findEmployee(pick(args, "employee_name") as string, pick(args, "employee_id", "employeeId") as string);
      if (!emp) return err("Не е намерен такъв служител.");

      // Списъкът на засегнатите месеци е информативен: ако хранилището не е
      // достъпно, предупреждението пак трябва да се покаже.
      const present: string[] = [];
      try {
        for (const sid of await db.listScheduleIds()) {
          const s = await db.loadSchedule(sid);
          if (s?.participants.some((p) => p.employeeId === emp.id)) present.push(sid);
        }
      } catch {
        /* без списък — текстът на предупреждението остава същият */
      }
      const trips = (st.tripBoard?.trips ?? []).filter((t) => t.employeeId === emp.id).length;

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "") || `Пълно изтриване на ${labelOf(emp)} от справочника`,
        cells: [],
        ops: [
          {
            kind: "roster.delete",
            label: `${labelOf(emp)} се изтрива напълно от справочника`,
            details: [
              present.length
                ? `Ще бъде премахнат от ${present.length} запазени месеца: ${present.join(", ")} — заедно с клетките му.`
                : "Не участва в запазени месеци.",
              ...(trips ? [`Ще бъдат изтрити и ${trips} повески.`] : []),
              "Действието не може да бъде отменено.",
            ],
            employeeId: emp.id,
          },
        ],
        danger: {
          title: "Необратимо изтриване",
          text:
            `${labelOf(emp)} ще бъде изтрит от справочника и от всички запазени месеци, заедно с клетките и повеските му. ` +
            "Действието е необратимо и за всички бъдещи месеци. Сигурни ли сте?",
          confirmLabel: "Да, изтрий необратимо",
        },
        source: "ai",
      });
      return awaiting({
        employee: labelOf(emp),
        neobratimo: true,
        zasegnatiMeseci: present,
        poveski: trips,
        message:
          "Предложението за НЕОБРАТИМО изтриване чака ДВОЙНО потвърждение от нарядчика — той трябва първо да потвърди, че разбира последствията, и чак тогава да натисне бутона за изтриване. Обясни му какво ще се загуби.",
      });
    }

    // ── Цял месец ─────────────────────────────────────────────────────────
    case "recalculate_month": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const h = target.schedule.header;
      const norm = countWorkingDays(h.year, h.month) * 8;

      st.proposePatch({
        summary: String(pick(args, "summary") ?? "") || `Преизчисляване на ${h.month}/${h.year}`,
        cells: [],
        ops: [
          {
            kind: "month.recalc",
            label: `Преизчисляване на месец ${h.month}/${h.year}`,
            details: [
              `Норма от производствения календар: ${formatHours(h.normHours, 0)} → ${formatHours(norm, 0)} ч. (${countWorkingDays(h.year, h.month)} работни дни × 8 ч.)`,
              `Остатъкът (+/−) на ${target.schedule.employees.length} служители се взема наново от предходния месец.`,
              "Часовете, приравняването и балансът по редовете се смятат при всяко показване и се обновяват веднага.",
            ],
          },
        ],
        source: "ai",
      });
      return awaiting({ month: `${h.month}/${h.year}`, normaSega: h.normHours, normaSledTova: norm });
    }

    case "generate_full_month": {
      if (pick(args, "module") === "reisi") {
        return err(
          'generate_full_month работи само за module "smeni". Повеските се съставят една по една с create_povesa или с assign_next_trip.',
        );
      }
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      const schedule = target.schedule;
      const dim = daysInMonth(schedule.header.year, schedule.header.month);

      const changes: CellChange[] = [];
      const perEmployee: Record<string, unknown>[] = [];
      const bezShablon: string[] = [];

      for (const e of schedule.employees) {
        const pattern = roster.find((r) => r.id === e.id)?.pattern;
        if (!pattern || pattern.kind === "none") {
          bezShablon.push(e.name);
          continue;
        }
        const existing = schedule.cells[e.id] ?? {};
        const base = rowFromPattern(pattern, existing, schedule.header);
        const balanced = balanceToNorm(base, e, schedule.header);
        const rowChanges = diffRow(e.id, balanced.row, existing, dim);
        changes.push(...rowChanges);

        const t = calcEmployee({ header: schedule.header, cells: { [e.id]: balanced.row } }, e, settings);
        perEmployee.push({
          employee: e.name,
          shablon: describePattern(pattern, settings),
          smeneniKletki: rowChanges.length,
          pochivniPoNorma: balanced.removed,
          rabotniDni: t.workDays,
          obshtoChasove: +t.total.toFixed(2),
          norma: +t.norm.toFixed(2),
          ostatakZaSledvashtMesec: +t.carryForward.toFixed(2),
        });
      }

      if (!changes.length) {
        return J({
          applied: false,
          message: "Разстановката по шаблоните вече е налице — няма какво да се смени.",
          bezShablon,
        });
      }

      st.proposePatch({
        summary:
          String(pick(args, "summary") ?? "") ||
          `Съставяне наново на графика за ${schedule.header.month}/${schedule.header.year} по базовите шаблони`,
        cells: changes,
        source: "ai",
      });
      return awaiting({
        month: `${schedule.header.month}/${schedule.header.year}`,
        changeCount: changes.length,
        zasegnatiSluzhiteli: perEmployee.length,
        bezShablon,
        poSluzhitel: perEmployee,
        note:
          "Нарядчикът вижда пълния списък на всички засегнати клетки в предпросмотъра. Отпуските, болничните и командировките са запазени; доработките остават за ръчна разстановка.",
      });
    }

    // ── Шапка ─────────────────────────────────────────────────────────────
    case "propose_header_changes": {
      const target = writeTarget(args);
      if ("error" in target) return err(target.error);
      st.proposePatch({
        summary: String(pick(args, "summary") ?? "Промени в шапката"),
        cells: [],
        header: pick(args, "header") as Record<string, unknown>,
        source: "ai",
      });
      return awaiting({});
    }

    default:
      return err(`Непознат инструмент: ${rawName}`);
  }
}

/** Съставът на отворения месец — за проверките при повеските. */
function schedule_employees(): Employee[] {
  return useApp.getState().employees;
}

/** Кратко текстово резюме на състоянието — прикача се към първото съобщение. */
export function contextSummary(): string {
  const st = useApp.getState();
  const { settings } = st;
  const schedule = resolved(st);
  if (!schedule) return "";
  const totals = calcAll(schedule, settings);
  const v = validateSchedule(schedule, settings);
  const errors = v.filter((x) => x.severity === "error").length;
  const lines = schedule.employees.map((e) => {
    const t = totals[e.id];
    const dor = e.carryOverReason
      ? ` ⚠ ДОРАБОТКА след отпуск от ${e.carryOverReason.fromMonth}: ${formatHours(e.carryOverReason.hours)} ч.`
      : "";
    return `- ${e.name || "(без име)"} (${e.position}) [id ${e.id}]: общо ${formatHours(t.total)} ч. при норма ${formatHours(t.norm)} ч., (+/−) ${formatHours(t.diff)} ч., ${t.workDays} работни дни.${dor}`;
  });
  const priority = schedule.employees.filter((e) => e.carryOverReason);
  return [
    `Текущ график: ${schedule.header.brigade}, ${schedule.header.month}/${schedule.header.year}.`,
    `Норма ${formatHours(schedule.header.normHours, 0)} ч. (производствен календар: ${countWorkingDays(schedule.header.year, schedule.header.month)} работни дни), статус: ${schedule.status}.`,
    `Служители: ${schedule.employees.length}. Нарушения от правния двигател: ${errors}.`,
    `Повески в месеца: ${(st.tripBoard?.trips ?? []).length}.`,
    ...lines,
    ...(priority.length
      ? [
          "",
          `ПРИОРИТЕТ: ${priority.length} служители влизат в месеца с минус от ползван отпуск. ` +
            "На тях първо предложи разстановка на доработки (кодове 4–9), за да покрият часовете.",
        ]
      : []),
  ].join("\n");
}

export { calcCell };
