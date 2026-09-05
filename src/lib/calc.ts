import type { Cell, Employee, ResolvedSchedule, Schedule, Settings, ShiftCode } from "./types";
import { breaksMinutes, daysInMonth, isNonWorking, isoWeek, nightOverlapMinutes, parseHM, spanMinutes } from "./time";
import { isHoliday } from "./holidays";

/** Изчислено съдържание на една клетка от мрежата. */
export type CellCalc = {
  code: ShiftCode | null;
  /** Отработени часове по клетката. */
  workHours: number;
  /** Сурови нощни часове (22:00–06:00), без приравняване. */
  nightHours: number;
  /** Часове, паднали се в официален празник — заплащат се удвоено (чл.264 КТ). */
  holidayHours: number;
  /** Продължителност на смяната от явка до освобождаване (за чл.13/14). */
  spanHours: number;
  leaveHours: number;
  sickHours: number;
  /** Абсолютни минути от началото на месеца — за междусменната почивка. */
  startAbs?: number;
  endAbs?: number;
};

export const EMPTY_CALC: CellCalc = {
  code: null,
  workHours: 0,
  nightHours: 0,
  holidayHours: 0,
  spanHours: 0,
  leaveHours: 0,
  sickHours: 0,
};

export function findCode(settings: Settings, codeId: string): ShiftCode | null {
  return settings.codes.find((c) => c.id === codeId) ?? null;
}

export function calcCell(
  cell: Cell | undefined,
  day: number,
  employee: Employee,
  settings: Settings,
  period?: { year: number; month: number },
): CellCalc {
  if (!cell) return EMPTY_CALC;
  const code = findCode(settings, cell.codeId);
  if (!code) return EMPTY_CALC;

  const base: CellCalc = { ...EMPTY_CALC, code };

  // Отпускът и болничният се отбелязват като непрекъснат блок в календара,
  // но в часове се отчитат само за работните дни от периода — иначе съботите,
  // неделите и празниците биха надули "Ползван отпуск" и "Общо часове".
  const nonWorking = period ? isNonWorking(period.year, period.month, day) : false;
  const holiday = period ? isHoliday(period.year, period.month, day) : false;
  /** Отработеното в официален празник се отчита и отделно — за удвоеното заплащане. */
  const withHoliday = (c: CellCalc): CellCalc => (holiday ? { ...c, holidayHours: c.workHours } : c);

  switch (code.category) {
    case "leave":
      return { ...base, leaveHours: nonWorking ? 0 : (cell.overrideHours ?? employee.dailyNorm) };
    case "sick":
      return { ...base, sickHours: nonWorking ? 0 : (cell.overrideHours ?? employee.dailyNorm) };
    case "absent":
      return base;
    case "trip":
    case "other":
      return withHoliday({ ...base, workHours: cell.overrideHours ?? employee.dailyNorm });
    case "work":
      break;
  }

  if (!code.start || !code.end) {
    return withHoliday({ ...base, workHours: cell.overrideHours ?? code.hours ?? 0 });
  }

  const startMin = parseHM(code.start);
  const spanMin = spanMinutes(code.start, code.end);
  const brMin = breaksMinutes(code.breaks);
  const workMin = (cell.overrideHours ?? code.hours ?? (spanMin - brMin) / 60) * 60;

  // Нощни часове = нощно припокриване на смяната минус нощната част на почивките.
  let nightMin = nightOverlapMinutes(startMin, startMin + spanMin, settings.nightStart, settings.nightEnd);
  for (const b of code.breaks) {
    const bs = parseHM(b.start);
    // Почивката се разполага спрямо началото на смяната (може да е след полунощ).
    const bsAbs = bs >= startMin ? bs : bs + 1440;
    nightMin -= nightOverlapMinutes(bsAbs, bsAbs + spanMinutes(b.start, b.end), settings.nightStart, settings.nightEnd);
  }
  nightMin = Math.max(0, nightMin);

  const dayOffset = (day - 1) * 1440;
  return withHoliday({
    ...base,
    workHours: workMin / 60,
    nightHours: nightMin / 60,
    spanHours: spanMin / 60,
    startAbs: dayOffset + startMin,
    endAbs: dayOffset + startMin + spanMin,
  });
}

/** Итоговият блок на реда (част C.2, формули D.5). */
export type EmployeeTotals = {
  employeeId: string;
  /** Отработени часове. */
  worked: number;
  /** Сурови нощни часове. */
  night: number;
  /** Приравнен нощен труд = нощни × 8/7 (част C.5). */
  nightEqualized: number;
  /** Отработени часове, паднали се в официални празници (чл.264 КТ — удвоено). */
  holidayHours: number;
  /** Брой дни с работа в официален празник. */
  holidayDays: number;
  /** Добавката от приравняването, която влиза в "Общо часове". */
  nightSurplus: number;
  /** Ползван отпуск (ДО, НО, СО, УО) в часове. */
  leave: number;
  /** Ползван МО в часове. */
  sick: number;
  /** Общо часове за месеца. */
  total: number;
  /** Месечна норма за конкретния служител. */
  norm: number;
  /** (+/-) за месеца. */
  diff: number;
  /** Остатък (+/-) за следващия месец. */
  carryForward: number;
  /** Часове над нормата на периода — извънреден труд (D.5 т.6). */
  overtime: number;
  /**
   * Фактически работни дни на служителя за месеца (дни с работен код,
   * командировка или медицински преглед). Индивидуален показател — затова
   * стои на реда, а не в шапката на бланката.
   */
  workDays: number;
  leaveDays: number;
  sickDays: number;
  absentDays: number;
};

/**
 * Месечна норма на служителя. Стойността от шапката е за пълно работно време
 * (8 ч/ден); при намалено работно време се мащабира пропорционално.
 */
export function employeeNorm(schedule: Pick<Schedule, "header">, employee: Employee): number {
  return schedule.header.normHours * (employee.dailyNorm / 8);
}

export function calcEmployee(
  schedule: Pick<Schedule, "header" | "cells">,
  employee: Employee,
  settings: Settings,
): EmployeeTotals {
  const dim = daysInMonth(schedule.header.year, schedule.header.month);
  const row = schedule.cells[employee.id] ?? {};
  let worked = 0, night = 0, leave = 0, sick = 0, holidayHours = 0;
  let workDays = 0, leaveDays = 0, sickDays = 0, absentDays = 0, holidayDays = 0;

  for (let d = 1; d <= dim; d++) {
    const c = calcCell(row[d], d, employee, settings, schedule.header);
    worked += c.workHours;
    night += c.nightHours;
    holidayHours += c.holidayHours;
    if (c.holidayHours > 0) holidayDays++;
    leave += c.leaveHours;
    sick += c.sickHours;
    if (!c.code) continue;
    if (c.code.category === "leave") leaveDays++;
    else if (c.code.category === "sick") sickDays++;
    else if (c.code.category === "absent") absentDays++;
    else workDays++;
  }

  const nightEqualized = night * settings.nightFactor;
  const nightSurplus = nightEqualized - night;
  const total = worked + nightSurplus + leave + sick;
  const norm = employeeNorm(schedule, employee);
  const diff = total - norm;

  return {
    employeeId: employee.id,
    worked, night, nightEqualized, nightSurplus, leave, sick,
    holidayHours, holidayDays,
    total, norm, diff,
    carryForward: employee.carryOver + diff,
    overtime: Math.max(0, diff),
    workDays, leaveDays, sickDays, absentDays,
  };
}

export function calcAll(schedule: ResolvedSchedule, settings: Settings): Record<string, EmployeeTotals> {
  const out: Record<string, EmployeeTotals> = {};
  for (const e of schedule.employees) out[e.id] = calcEmployee(schedule, e, settings);
  return out;
}

/** Сума по бригадата — долният ред на таблицата. */
export function calcBrigade(totals: Record<string, EmployeeTotals>): EmployeeTotals {
  const list = Object.values(totals);
  const sum = (f: (t: EmployeeTotals) => number) => list.reduce((a, t) => a + f(t), 0);
  return {
    employeeId: "__brigade__",
    worked: sum((t) => t.worked),
    night: sum((t) => t.night),
    nightEqualized: sum((t) => t.nightEqualized),
    nightSurplus: sum((t) => t.nightSurplus),
    holidayHours: sum((t) => t.holidayHours),
    holidayDays: sum((t) => t.holidayDays),
    leave: sum((t) => t.leave),
    sick: sum((t) => t.sick),
    total: sum((t) => t.total),
    norm: sum((t) => t.norm),
    diff: sum((t) => t.diff),
    carryForward: sum((t) => t.carryForward),
    overtime: sum((t) => t.overtime),
    workDays: sum((t) => t.workDays),
    leaveDays: sum((t) => t.leaveDays),
    sickDays: sum((t) => t.sickDays),
    absentDays: sum((t) => t.absentDays),
  };
}

/** Отработени часове по седмици (ISO) — за контрола по D.6 (седмична норма). */
export function weeklyHours(
  schedule: Pick<Schedule, "header" | "cells">,
  employee: Employee,
  settings: Settings,
): Record<string, { hours: number; days: number[] }> {
  const dim = daysInMonth(schedule.header.year, schedule.header.month);
  const row = schedule.cells[employee.id] ?? {};
  const out: Record<string, { hours: number; days: number[] }> = {};
  for (let d = 1; d <= dim; d++) {
    const w = isoWeek(schedule.header.year, schedule.header.month, d);
    out[w] ??= { hours: 0, days: [] };
    out[w].days.push(d);
    out[w].hours += calcCell(row[d], d, employee, settings, schedule.header).workHours;
  }
  return out;
}
