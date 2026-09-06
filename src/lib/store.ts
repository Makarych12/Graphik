"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type {
  CarryOverReason, Cell, Employee, ResolvedSchedule, RosterEmployee, Schedule, ScheduleHeader,
  ScheduleParticipant, ScheduleStatus, Settings, Trip, TripBoard, Violation,
} from "./types";
import { DEFAULT_HEADER, DEFAULT_SETTINGS, emptyRosterEmployee } from "./defaults";
import { seedRoster, seedSchedule } from "./seed";
import * as db from "./db";
import { calcEmployee } from "./calc";
import { countWorkingDays, scheduleId } from "./time";
import { setHolidayOverrides } from "./holidays";
import { patternMonth } from "./patterns";
import { validateSchedule } from "./validation";
import { validateTrips } from "./trips";

/** Едно предложено изменение на клетка — за предпросмотъра преди прилагане (D.7.1). */
export type CellChange = {
  employeeId: string;
  day: number;
  from: Cell | null;
  to: Cell | null;
};

/**
 * Действие в предложението, което не е клетка: справочник, състав на месеца,
 * повеска или преизчисляване. Всяко носи готов човешки текст (`label`) и по
 * желание редове „беше → ще стане“ (`details`), за да може предпросмотърът да
 * се чете, без да се показва суров JSON (D.7.1).
 */
export type PatchOp =
  | { kind: "roster.add"; label: string; details?: string[]; data: Partial<RosterEmployee> }
  | { kind: "roster.update"; label: string; details?: string[]; employeeId: string; changes: Partial<RosterEmployee> }
  | { kind: "roster.delete"; label: string; details?: string[]; employeeId: string }
  | { kind: "month.remove"; label: string; details?: string[]; employeeId: string }
  | { kind: "month.restore"; label: string; details?: string[]; employeeId: string }
  | { kind: "trip.create"; label: string; details?: string[]; trip: Trip }
  | { kind: "trip.update"; label: string; details?: string[]; tripId: string; changes: Partial<Trip> }
  | { kind: "month.recalc"; label: string; details?: string[] };

export type Patch = {
  id: string;
  /** Кратко описание, което ИИ дава на предложението. */
  summary: string;
  /** Отделните описания, когато предложението е събрано от няколко извиквания. */
  summaries?: string[];
  /**
   * Ходът на разговора, в който е съставено. Извикванията в рамките на един
   * отговор на модела се наливат в едно предложение; ново съобщение от
   * нарядчика започва нов ход и не пипа непотвърденото отпреди.
   */
  turnId?: string;
  /**
   * Предложение, което се показва само самостоятелно и не се смесва с
   * обикновени поправки: необратимо изтриване и съставяне на цял месец.
   */
  exclusive?: boolean;
  cells: CellChange[];
  header?: Partial<ScheduleHeader>;
  /** Промени извън клетките — по реда, в който трябва да се приложат. */
  ops?: PatchOp[];
  /**
   * Необратимо действие: предпросмотърът иска отделно, по-силно потвърждение
   * вместо обичайното „Приложи“ (изтриване от справочника).
   */
  danger?: { title: string; text: string; confirmLabel: string };
  /** Източник — за да се вижда кой е предложил промяната. */
  source: "ai" | "user";
};

/**
 * Какво се е случило при последното прилагане. Правната проверка се пуска
 * автоматично веднага след записа и новите нарушения се показват на нарядчика;
 * промяната НЕ се отменя автоматично — само се сигнализира (D.7.1 т.5).
 */
export type ApplyReport = {
  at: string;
  summary: string;
  /** Брой нарушения (error) преди и след прилагането. */
  before: number;
  after: number;
  /** Нарушенията, които се появяват заради тази промяна. */
  fresh: Violation[];
  /** Стигна ли промяната до хранилището, или е останала само в паметта. */
  saved: boolean;
  /** Защо записът не е минал — показва се на нарядчика. */
  saveError?: string;
};

export type SaveReport = {
  at: string;
  employees: number;
  filledCells: number;
  errors: number;
  warnings: number;
};

type State = {
  ready: boolean;
  settings: Settings;
  /** Постоянният състав на бригадата — общ за всички месеци. */
  roster: RosterEmployee[];
  monthId: string;
  schedule: Schedule | null;
  /** Разрешен състав за текущия месец: справочник + участие. Изчислява се от стора. */
  employees: Employee[];
  tripBoard: TripBoard | null;
  pendingPatch: Patch | null;
  online: boolean;
  dirty: boolean;
  lastSaved: SaveReport | null;

  init: () => Promise<void>;
  openMonth: (year: number, month: number) => Promise<void>;

  updateHeader: (patch: Partial<ScheduleHeader>) => void;
  recomputeNorm: () => void;
  setStatus: (s: ScheduleStatus) => void;

  // ── Справочник ────────────────────────────────────────────────────────────
  addToRoster: (patch?: Partial<RosterEmployee>) => string;
  updateRosterEmployee: (id: string, patch: Partial<RosterEmployee>) => void;
  /** Изважда от състава: остава в миналите графици, но не влиза в нови месеци. */
  setRosterActive: (id: string, active: boolean) => void;
  /** Необратимо: маха човека от справочника И от всички запазени месеци. */
  deleteFromRoster: (id: string) => Promise<void>;

  // ── Състав на конкретния месец ────────────────────────────────────────────
  addParticipant: (employeeId: string) => void;
  removeParticipant: (employeeId: string) => void;
  updateParticipant: (employeeId: string, patch: Partial<ScheduleParticipant>) => void;
  /** Записва в справочника или в участието според полето. */
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  moveEmployee: (id: string, dir: -1 | 1) => void;
  toggleAcknowledged: (id: string) => void;
  /** Добавя всички активни от справочника, които липсват в този месец. */
  syncFromRoster: () => number;
  /** Подтегля новите от справочника, без да връща изрично извадените. */
  syncRosterIntoMonth: () => number;
  /** Разстила базовите шаблони на смените върху текущия месец (D.2.1). */
  applyPatterns: (overwrite?: boolean) => number;

  setCell: (employeeId: string, day: number, cell: Cell | null) => void;
  setCells: (changes: CellChange[]) => void;
  fillRange: (employeeId: string, from: number, to: number, codeId: string | null) => void;
  clearMonth: (employeeId?: string) => void;

  updateSettings: (patch: Partial<Settings>) => void;

  addTrip: (t: Trip) => void;
  updateTrip: (id: string, patch: Partial<Trip>) => void;
  removeTrip: (id: string) => void;

  /** Преизчислява нормата от производствения календар и пренесените остатъци. */
  recalculateMonth: () => Promise<{ normHours: number; participants: number }>;

  /** Идентификатор на текущия ход — сменя се при всяко ново съобщение. */
  turnId: string;
  /** Отбелязва начало на нов ход (ново съобщение от нарядчика). */
  beginTurn: () => void;

  proposePatch: (p: Omit<Patch, "id">) => void;
  applyPendingPatch: () => Promise<ApplyReport | null>;
  discardPendingPatch: () => void;
  /** Резултатът от автоматичната проверка след последното прилагане. */
  lastApply: ApplyReport | null;
  clearLastApply: () => void;

  saveNow: () => Promise<SaveReport>;
};

/** Обединява справочника с участието в месеца — редът е редът на участниците. */
export function resolveEmployees(schedule: Schedule | null, roster: RosterEmployee[]): Employee[] {
  if (!schedule) return [];
  const byId = new Map(roster.map((e) => [e.id, e]));
  const out: Employee[] = [];
  for (const p of schedule.participants) {
    const r = byId.get(p.employeeId);
    if (!r) continue; // изтрит от справочника
    out.push({
      id: r.id,
      serviceNo: r.serviceNo,
      name: r.name,
      position: r.position,
      annualLeaveDays: r.annualLeaveDays,
      dailyNorm: r.dailyNorm,
      pattern: r.pattern,
      carryOver: p.carryOver,
      carryOverReason: p.carryOverReason,
      acknowledged: p.acknowledged,
      acknowledgedAt: p.acknowledgedAt,
    });
  }
  return out;
}

/** Готов за изчисления изглед на текущия месец. */
export function resolved(s: Pick<State, "schedule" | "employees">): ResolvedSchedule | null {
  if (!s.schedule) return null;
  const { participants: _p, ...rest } = s.schedule;
  void _p;
  return { ...rest, employees: s.employees };
}

/** Реална ли е промяната по клетката, или се връща същото. */
function changesSomething(c: CellChange): boolean {
  return (
    (c.from?.codeId ?? null) !== (c.to?.codeId ?? null) ||
    c.to?.extension?.approved !== c.from?.extension?.approved
  );
}

/**
 * Слива две предложения в едно. При два пъти пипана клетка се пази истинското
 * „беше“ от първата промяна и последното „става“ — иначе предпросмотърът би
 * показал междинно състояние, което нарядчикът никога не е виждал.
 */
function mergePatches(a: Patch, b: Patch): Patch {
  const cells = [...a.cells];
  for (const ch of b.cells) {
    const i = cells.findIndex((c) => c.employeeId === ch.employeeId && c.day === ch.day);
    if (i >= 0) cells[i] = { ...ch, from: cells[i].from };
    else cells.push(ch);
  }
  const summaries = [...new Set([...(a.summaries ?? [a.summary]), ...(b.summaries ?? [b.summary])])];
  const header = a.header || b.header ? { ...a.header, ...b.header } : undefined;
  return {
    ...a,
    cells: cells.filter(changesSomething),
    ops: [...(a.ops ?? []), ...(b.ops ?? [])],
    ...(header ? { header } : {}),
    summaries,
    summary: summaries.join(" · "),
  };
}

/** Правната картина, но без да хвърля — ползва се около прилагането. */
function safeViolations(s: Pick<State, "schedule" | "employees" | "settings" | "tripBoard">): Violation[] {
  try {
    return violationsNow(s);
  } catch {
    return [];
  }
}

/** Пълната правна картина в момента: смени + повески. */
function violationsNow(s: Pick<State, "schedule" | "employees" | "settings" | "tripBoard">): Violation[] {
  const sched = resolved(s);
  if (!sched) return [];
  return [
    ...validateSchedule(sched, s.settings),
    ...validateTrips(s.tripBoard?.trips ?? [], sched.employees, s.settings),
  ];
}

/**
 * Подтегля в месеца всички активни от справочника, които още не участват и не
 * са изрично извадени. Така служител, заведен през септември, се появява и в
 * октомври — дори октомври да е бил открит по-рано.
 */
export function syncParticipants(schedule: Schedule, roster: RosterEmployee[]): Schedule {
  const excluded = new Set(schedule.excluded ?? []);
  const present = new Set(schedule.participants.map((p) => p.employeeId));
  const missing = roster.filter((e) => e.active && !present.has(e.id) && !excluded.has(e.id));
  if (!missing.length) return schedule;
  return {
    ...schedule,
    participants: [
      ...schedule.participants,
      ...missing.map((e) => ({ employeeId: e.id, carryOver: 0, acknowledged: false })),
    ],
  };
}

/**
 * Пренася остатъка от непосредствено предходния месец и — когато минусът идва
 * от ползван отпуск — записва защо. Механизмът на пренасяне е същият (D.5 т.5);
 * обяснението е само за да не бърка нарядчикът "доработка след отпуск" с
 * обикновена недоработка.
 *
 * Ползва се на две места: при създаване на месец и когато служител се появи в
 * вече открит месец (подтегляне от справочника или ръчно добавяне) — иначе той
 * би влязъл с нулев остатък.
 */
async function makeCarryOf(
  year: number,
  month: number,
  roster: RosterEmployee[],
  settings: Settings,
): Promise<(employeeId: string) => { hours: number; reason?: CarryOverReason }> {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prev = await db.loadSchedule(scheduleId(prevYear, prevMonth));

  return (employeeId: string) => {
    if (!prev) return { hours: 0 };
    const emp = resolveEmployees(prev, roster).find((e) => e.id === employeeId);
    if (!emp) return { hours: 0 };
    const t = calcEmployee(prev, emp, settings);
    if (t.carryForward < 0 && t.leaveDays > 0 && t.diff < 0) {
      return {
        hours: t.carryForward,
        reason: {
          kind: "leave",
          fromMonth: prev.id,
          leaveDays: t.leaveDays,
          leaveHours: t.leave,
          hours: -t.diff,
        },
      };
    }
    return { hours: t.carryForward };
  };
}

/** Клетките на един служител по базовия му шаблон за дадения месец. */
function patternCells(
  employee: RosterEmployee,
  year: number,
  month: number,
): Record<number, Cell> {
  const row = patternMonth(employee.pattern, year, month);
  const out: Record<number, Cell> = {};
  for (const [day, codeId] of Object.entries(row)) out[Number(day)] = { codeId };
  return out;
}

/** Полетата, които живеят в справочника, а не в конкретния месец. */
const ROSTER_FIELDS = ["serviceNo", "name", "position", "annualLeaveDays", "dailyNorm"] as const;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Броячът гарантира различен ход и при две съобщения в една милисекунда. */
let turnSeq = 0;

export const useApp = create<State>((set, get) => {
  const persist = async () => {
    const { schedule, tripBoard, settings, roster } = get();
    if (schedule) await db.saveSchedule(schedule);
    if (tripBoard) await db.saveTrips(tripBoard);
    await db.saveSettings(settings);
    await db.saveRoster({ employees: roster, updatedAt: new Date().toISOString() });
    set({ dirty: false });
  };

  /** Изпразва отложения запис — задължително преди смяна на месеца. */
  const flush = async () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (get().dirty) await persist().catch(() => undefined);
  };

  const touch = (patch: Partial<State>) => {
    set({ ...patch, dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    // Отложеният запис не бива да хвърля: при затворено съединение към базата
    // (напр. изчистено хранилище) състоянието просто остава "незаписано".
    saveTimer = setTimeout(() => { persist().catch(() => set({ dirty: true })); }, 400);
  };

  /** Мутация на графика с преизчисляване на разрешения състав. */
  const mutate = (fn: (s: Schedule) => Schedule) => {
    const cur = get().schedule;
    if (!cur) return;
    const next = { ...fn(cur), updatedAt: new Date().toISOString() };
    touch({ schedule: next, employees: resolveEmployees(next, get().roster) });
  };

  const mutateRoster = (fn: (r: RosterEmployee[]) => RosterEmployee[]) => {
    const roster = fn(get().roster);
    touch({ roster, employees: resolveEmployees(get().schedule, roster) });
  };

  /**
   * Създава месец: съставът идва от справочника, нормата — от производствения
   * календар, клетките са празни, а от предходния месец се пренася само
   * остатъкът (+/−).
   */
  const buildMonth = async (year: number, month: number): Promise<Schedule> => {
    const roster = get().roster;
    const settings = get().settings;

    // Шапката се наследява от последния наличен месец (реквизити на депото).
    const ids = await db.listScheduleIds();
    const latest = ids.length ? await db.loadSchedule(ids[0]) : undefined;
    const baseHeader = latest?.header ?? DEFAULT_HEADER;

    const carryOf = await makeCarryOf(year, month, roster, settings);
    const active = roster.filter((e) => e.active);
    const cells: Schedule["cells"] = {};
    for (const e of active) {
      const row = patternCells(e, year, month);
      if (Object.keys(row).length) cells[e.id] = row;
    }

    return {
      id: scheduleId(year, month),
      header: { ...baseHeader, year, month, normHours: countWorkingDays(year, month) * 8 },
      participants: active.map((e) => {
        const c = carryOf(e.id);
        return {
          employeeId: e.id,
          carryOver: c.hours,
          acknowledged: false,
          ...(c.reason ? { carryOverReason: c.reason } : {}),
        };
      }),
      cells,
      status: "draft",
      updatedAt: new Date().toISOString(),
    };
  };

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    roster: [],
    monthId: "",
    schedule: null,
    employees: [],
    tripBoard: null,
    pendingPatch: null,
    turnId: "t0",
    lastApply: null,
    online: true,
    dirty: false,
    lastSaved: null,

    async init() {
      const settings = await db.loadSettings();
      setHolidayOverrides(settings.holidays);

      const ids = await db.listScheduleIds();
      // Минаваме през ВСИЧКИ месеци, а не само през последния: миграцията от
      // стария формат вади служителите в справочника и ако пропуснем месец,
      // хората от него така и не влизат в общия списък.
      for (const sid of ids) await db.loadSchedule(sid);

      let roster = (await db.loadRoster()).employees;
      let schedule = ids.length ? await db.loadSchedule(ids[0]) : undefined;

      if (!schedule) {
        if (!roster.length) roster = seedRoster(settings);
        schedule = seedSchedule(settings, roster);
        await db.saveRoster({ employees: roster, updatedAt: new Date().toISOString() });
        await db.saveSchedule(schedule);
      } else {
        const synced = syncParticipants(schedule, roster);
        if (synced !== schedule) { schedule = synced; await db.saveSchedule(schedule); }
      }

      const tripBoard =
        (await db.loadTrips(schedule.id)) ?? { id: schedule.id, trips: [], updatedAt: new Date().toISOString() };

      set({
        ready: true,
        settings,
        roster,
        schedule,
        employees: resolveEmployees(schedule, roster),
        tripBoard,
        monthId: schedule.id,
        dirty: false,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      });
    },

    async openMonth(year, month) {
      // Първо записваме текущия месец: иначе отложеният таймер щеше да се задейства
      // след превключването и да запише новия месец вместо стария.
      await flush();

      const id = scheduleId(year, month);
      const roster = get().roster;
      const settings = get().settings;
      let schedule = await db.loadSchedule(id);

      if (!schedule) {
        schedule = await buildMonth(year, month);
      } else {
        // Месецът може да е бил открит преди в справочника да се появят нови хора.
        const before = new Set(schedule.participants.map((p) => p.employeeId));
        const synced = syncParticipants(schedule, roster);
        const added = synced.participants.filter((p) => !before.has(p.employeeId));

        if (added.length) {
          // Новодошлите трябва да получат същото, което биха получили при
          // създаване на месеца: пренесен остатък и чернова по шаблона.
          const carryOf = await makeCarryOf(year, month, roster, settings);
          const cells = { ...synced.cells };
          for (const p of added) {
            const c = carryOf(p.employeeId);
            p.carryOver = c.hours;
            if (c.reason) p.carryOverReason = c.reason;
            const emp = roster.find((e) => e.id === p.employeeId);
            const row = cells[p.employeeId];
            if (emp && (!row || !Object.keys(row).length)) {
              const draft = patternCells(emp, year, month);
              if (Object.keys(draft).length) cells[p.employeeId] = draft;
            }
          }
          schedule = { ...synced, cells, updatedAt: new Date().toISOString() };
        } else {
          schedule = synced;
        }
      }
      await db.saveSchedule(schedule);

      const tripBoard = (await db.loadTrips(id)) ?? { id, trips: [], updatedAt: new Date().toISOString() };
      set({
        schedule,
        employees: resolveEmployees(schedule, roster),
        tripBoard,
        monthId: id,
        pendingPatch: null,
        dirty: false,
      });
    },

    updateHeader(patch) {
      mutate((s) => ({ ...s, header: { ...s.header, ...patch } }));
    },

    recomputeNorm() {
      const s = get().schedule;
      if (!s) return;
      get().updateHeader({ normHours: countWorkingDays(s.header.year, s.header.month) * 8 });
    },

    setStatus(status) {
      mutate((s) => ({ ...s, status }));
    },

    // ── Справочник ──────────────────────────────────────────────────────────

    addToRoster(patch) {
      const e = { ...emptyRosterEmployee(get().roster.length), ...patch };
      mutateRoster((r) => [...r, e]);
      return e.id;
    },

    updateRosterEmployee(id, patch) {
      mutateRoster((r) => r.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },

    setRosterActive(id, active) {
      get().updateRosterEmployee(id, { active });
    },

    async deleteFromRoster(id) {
      mutateRoster((r) => r.filter((e) => e.id !== id));
      // Маха се и от всички запазени месеци, включително клетките.
      for (const sid of await db.listScheduleIds()) {
        const s = await db.loadSchedule(sid);
        if (!s || !s.participants.some((p) => p.employeeId === id)) continue;
        const cells = { ...s.cells };
        delete cells[id];
        await db.saveSchedule({
          ...s,
          participants: s.participants.filter((p) => p.employeeId !== id),
          cells,
          updatedAt: new Date().toISOString(),
        });
      }
      const cur = get().schedule;
      if (cur?.participants.some((p) => p.employeeId === id)) {
        const cells = { ...cur.cells };
        delete cells[id];
        mutate((s) => ({ ...s, participants: s.participants.filter((p) => p.employeeId !== id), cells }));
      }
      const tb = get().tripBoard;
      if (tb) touch({ tripBoard: { ...tb, trips: tb.trips.filter((t) => t.employeeId !== id) } });
    },

    // ── Състав на месеца ────────────────────────────────────────────────────

    addParticipant(employeeId) {
      const cur = get().schedule;
      if (!cur || cur.participants.some((p) => p.employeeId === employeeId)) return;
      const emp = get().roster.find((e) => e.id === employeeId);
      mutate((s) => {
        // Ако редът му е празен, разстиламе черновата по шаблона.
        const existing = s.cells[employeeId];
        const draft =
          emp && (!existing || !Object.keys(existing).length)
            ? patternCells(emp, s.header.year, s.header.month)
            : null;
        return {
          ...s,
          participants: [...s.participants, { employeeId, carryOver: 0, acknowledged: false }],
          excluded: (s.excluded ?? []).filter((x) => x !== employeeId),
          ...(draft && Object.keys(draft).length ? { cells: { ...s.cells, [employeeId]: draft } } : {}),
        };
      });

      // Остатъкът от предходния месец се дочита асинхронно, за да не се бави
      // добавянето; интерфейсът се обновява веднага щом стойността е налична.
      const h = get().schedule?.header;
      if (!h) return;
      void makeCarryOf(h.year, h.month, get().roster, get().settings).then((carryOf) => {
        const c = carryOf(employeeId);
        if (c.hours === 0 && !c.reason) return;
        get().updateParticipant(employeeId, { carryOver: c.hours, carryOverReason: c.reason });
      });
    },

    /**
     * Изважда служителя от този месец. Клетките му се запазват — ако бъде
     * върнат, разстановката се възстановява, а личните данни се вземат наново
     * от справочника.
     */
    removeParticipant(employeeId) {
      mutate((s) => ({
        ...s,
        participants: s.participants.filter((p) => p.employeeId !== employeeId),
        excluded: [...new Set([...(s.excluded ?? []), employeeId])],
      }));
    },

    updateParticipant(employeeId, patch) {
      mutate((s) => ({
        ...s,
        participants: s.participants.map((p) => (p.employeeId === employeeId ? { ...p, ...patch } : p)),
      }));
    },

    updateEmployee(id, patch) {
      const rosterPatch: Partial<RosterEmployee> = {};
      const participantPatch: Partial<ScheduleParticipant> = {};
      for (const [k, v] of Object.entries(patch)) {
        if ((ROSTER_FIELDS as readonly string[]).includes(k)) {
          (rosterPatch as Record<string, unknown>)[k] = v;
        } else if (k !== "id") {
          (participantPatch as Record<string, unknown>)[k] = v;
        }
      }
      if (Object.keys(rosterPatch).length) get().updateRosterEmployee(id, rosterPatch);
      if (Object.keys(participantPatch).length) get().updateParticipant(id, participantPatch);
    },

    moveEmployee(id, dir) {
      mutate((s) => {
        const i = s.participants.findIndex((p) => p.employeeId === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.participants.length) return s;
        const participants = [...s.participants];
        [participants[i], participants[j]] = [participants[j], participants[i]];
        return { ...s, participants };
      });
    },

    toggleAcknowledged(id) {
      const p = get().schedule?.participants.find((x) => x.employeeId === id);
      if (!p) return;
      get().updateParticipant(id, {
        acknowledged: !p.acknowledged,
        acknowledgedAt: !p.acknowledged ? new Date().toISOString() : undefined,
      });
    },

    /**
     * Подтегля в отворения месец новите активни от справочника по същото
     * правило, както при откриване на месец: изрично извадените си остават
     * извън състава. Ползва се от „Запази“ в настройките, за да се види
     * промяната в графика веднага, без презареждане.
     */
    syncRosterIntoMonth() {
      const cur = get().schedule;
      if (!cur) return 0;
      const excluded = new Set(cur.excluded ?? []);
      const present = new Set(cur.participants.map((p) => p.employeeId));
      const missing = get().roster.filter(
        // Празен картон (току-що добавен, още неименуван) не е човек — не влиза
        // в графика, докато не бъде попълнен и записан.
        (e) => e.active && e.name.trim() !== "" && !present.has(e.id) && !excluded.has(e.id),
      );
      // addParticipant разстила черновата по шаблона и дочита остатъка от
      // предходния месец — затова не се добавя направо в participants.
      for (const e of missing) get().addParticipant(e.id);
      return missing.length;
    },

    /** Ръчно връщане и на изрично извадените — за случай "сгреших". */
    syncFromRoster() {
      const cur = get().schedule;
      if (!cur) return 0;
      const present = new Set(cur.participants.map((p) => p.employeeId));
      const missing = get().roster.filter((e) => e.active && !present.has(e.id));
      if (!missing.length) return 0;
      mutate((s) => ({
        ...s,
        participants: [
          ...s.participants,
          ...missing.map((e) => ({ employeeId: e.id, carryOver: 0, acknowledged: false })),
        ],
        excluded: [],
      }));
      return missing.length;
    },

    /**
     * Разстила шаблоните върху текущия месец. По подразбиране пипа само
     * празните клетки, за да не изтрие ръчната работа на нарядчика.
     */
    applyPatterns(overwrite = false) {
      const cur = get().schedule;
      if (!cur) return 0;
      const roster = get().roster;
      let filled = 0;
      mutate((s) => {
        const cells = { ...s.cells };
        for (const p of s.participants) {
          const emp = roster.find((e) => e.id === p.employeeId);
          if (!emp?.pattern || emp.pattern.kind === "none") continue;
          const draft = patternCells(emp, s.header.year, s.header.month);
          const row = { ...(cells[p.employeeId] ?? {}) };
          for (const [day, cell] of Object.entries(draft)) {
            const d = Number(day);
            if (!overwrite && row[d]) continue;
            row[d] = cell;
            filled++;
          }
          cells[p.employeeId] = row;
        }
        return { ...s, cells };
      });
      return filled;
    },

    // ── Клетки ──────────────────────────────────────────────────────────────

    setCell(employeeId, day, cell) {
      mutate((s) => {
        const row = { ...(s.cells[employeeId] ?? {}) };
        if (cell) row[day] = cell;
        else delete row[day];
        return { ...s, cells: { ...s.cells, [employeeId]: row } };
      });
    },

    setCells(changes) {
      mutate((s) => {
        const cells = { ...s.cells };
        for (const ch of changes) {
          const row = { ...(cells[ch.employeeId] ?? {}) };
          if (ch.to) row[ch.day] = ch.to;
          else delete row[ch.day];
          cells[ch.employeeId] = row;
        }
        return { ...s, cells };
      });
    },

    fillRange(employeeId, from, to, codeId) {
      const [a, b] = from <= to ? [from, to] : [to, from];
      const changes: CellChange[] = [];
      for (let d = a; d <= b; d++) {
        changes.push({ employeeId, day: d, from: null, to: codeId ? { codeId } : null });
      }
      get().setCells(changes);
    },

    clearMonth(employeeId) {
      mutate((s) => {
        if (!employeeId) return { ...s, cells: {} };
        const cells = { ...s.cells };
        delete cells[employeeId];
        return { ...s, cells };
      });
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      // Производственият календар се чете от целия код през модула holidays,
      // затова поправките се прилагат там веднага след промяната.
      if (patch.holidays) setHolidayOverrides(settings.holidays);
      touch({ settings });
    },

    addTrip(t) {
      const tb = get().tripBoard;
      if (!tb) return;
      touch({ tripBoard: { ...tb, trips: [...tb.trips, t], updatedAt: new Date().toISOString() } });
    },

    updateTrip(id, patch) {
      const tb = get().tripBoard;
      if (!tb) return;
      touch({
        tripBoard: {
          ...tb,
          trips: tb.trips.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          updatedAt: new Date().toISOString(),
        },
      });
    },

    removeTrip(id) {
      const tb = get().tripBoard;
      if (!tb) return;
      touch({ tripBoard: { ...tb, trips: tb.trips.filter((t) => t.id !== id), updatedAt: new Date().toISOString() } });
    },

    /**
     * Преизчислява месеца: нормата се взема наново от производствения календар,
     * а остатъкът (+/−) на всеки участник — от фактически записания предходен
     * месец. Самите часове по редовете се смятат при всяко показване, затова
     * тук се обновява само това, което наистина стои записано.
     */
    async recalculateMonth() {
      const cur = get().schedule;
      if (!cur) return { normHours: 0, participants: 0 };
      const { year, month } = cur.header;
      const normHours = countWorkingDays(year, month) * 8;
      const carryOf = await makeCarryOf(year, month, get().roster, get().settings);
      mutate((s) => ({
        ...s,
        header: { ...s.header, normHours },
        participants: s.participants.map((p) => {
          const c = carryOf(p.employeeId);
          const { carryOverReason: _drop, ...rest } = p;
          void _drop;
          return { ...rest, carryOver: c.hours, ...(c.reason ? { carryOverReason: c.reason } : {}) };
        }),
      }));
      return { normHours, participants: cur.participants.length };
    },

    beginTurn() {
      set({ turnId: `t${++turnSeq}${Date.now().toString(36)}` });
    },

    /**
     * Събира предложенията от един ход в едно. Когато нарядчикът каже
     * „попълни имената на всички“, моделът прави дванадесет извиквания в един
     * свой отговор — те трябва да се покажат като ЕДНО превю с дванадесет
     * реда, а не като дванадесет последователни питания.
     */
    proposePatch(p) {
      const turnId = get().turnId;
      const incoming: Patch = {
        ...p,
        id: `p${Date.now().toString(36)}`,
        turnId,
        summaries: [p.summary],
      };
      const cur = get().pendingPatch;
      const mergeable = cur && cur.turnId === turnId && !cur.exclusive && !incoming.exclusive;
      set({ pendingPatch: mergeable ? mergePatches(cur, incoming) : incoming });
    },

    /**
     * Прилага предложението и веднага пуска правната проверка. Новите нарушения
     * не отменят промяната — нарядчикът ги вижда и решава сам (D.7.1 т.5).
     */
    async applyPendingPatch() {
      const p = get().pendingPatch;
      if (!p) return null;

      // Правната картина е само за отчета — счупи ли се, прилагането трябва
      // да продължи, а не да остави нарядчика с бутон, който не прави нищо.
      const before = safeViolations(get());

      if (p.cells.length) get().setCells(p.cells);
      if (p.header) get().updateHeader(p.header);

      for (const op of p.ops ?? []) {
        switch (op.kind) {
          case "roster.add": {
            const id = get().addToRoster({ ...op.data, active: op.data.active ?? true });
            get().addParticipant(id);
            break;
          }
          case "roster.update":
            get().updateRosterEmployee(op.employeeId, op.changes);
            break;
          case "roster.delete":
            await get().deleteFromRoster(op.employeeId);
            break;
          case "month.remove":
            get().removeParticipant(op.employeeId);
            break;
          case "month.restore":
            get().addParticipant(op.employeeId);
            break;
          case "trip.create":
            get().addTrip(op.trip);
            break;
          case "trip.update":
            get().updateTrip(op.tripId, op.changes);
            break;
          case "month.recalc":
            await get().recalculateMonth();
            break;
        }
      }

      // Записваме веднага, а не след отложения таймер: иначе между клика и
      // записа има прозорец, в който презареждане или затворен раздел губи
      // промяната, при това без нито дума към нарядчика.
      let saved = true;
      let saveError: string | undefined;
      try {
        await get().saveNow();
      } catch (e) {
        saved = false;
        saveError = (e as Error)?.message || String(e);
      }

      const after = safeViolations(get());
      const known = new Set(before.map((v) => v.id));
      const report: ApplyReport = {
        at: new Date().toISOString(),
        summary: p.summary,
        before: before.filter((v) => v.severity === "error").length,
        after: after.filter((v) => v.severity === "error").length,
        fresh: after.filter((v) => v.severity !== "info" && !known.has(v.id)),
        saved,
        ...(saveError ? { saveError } : {}),
      };
      set({ pendingPatch: null, lastApply: report });
      return report;
    },

    discardPendingPatch() {
      set({ pendingPatch: null });
    },

    clearLastApply() {
      set({ lastApply: null });
    },

    /** Явно записване: изпразва отложения запис и връща какво е фиксирано. */
    async saveNow() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      await persist();
      const st = get();
      const r = resolved(st);
      const filledCells = r
        ? st.employees.reduce((a, e) => a + Object.keys(r.cells[e.id] ?? {}).length, 0)
        : 0;
      const { validateSchedule } = await import("./validation");
      const v = r ? validateSchedule(r, st.settings) : [];
      const report: SaveReport = {
        at: new Date().toISOString(),
        employees: st.employees.length,
        filledCells,
        errors: v.filter((x) => x.severity === "error").length,
        warnings: v.filter((x) => x.severity === "warning").length,
      };
      set({ lastSaved: report });
      return report;
    },
  };
});

/** Помощник: текущата стойност на клетка. */
export function cellOf(schedule: Schedule | null, employeeId: string, day: number): Cell | null {
  return schedule?.cells[employeeId]?.[day] ?? null;
}

/**
 * Разрешеният месец като единичен обект — за компонентите и изчисленията.
 * Обектът се сглобява в useMemo, а не в селектора: селектор, който връща нов
 * обект на всяко извикване, кара zustand да пререндира безкрайно.
 */
export function useResolved(): ResolvedSchedule | null {
  const schedule = useApp((s) => s.schedule);
  const employees = useApp((s) => s.employees);
  return useMemo(
    () => (schedule ? { ...schedule, employees } : null),
    [schedule, employees],
  );
}
