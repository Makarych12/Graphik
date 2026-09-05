"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { Roster, RosterEmployee, Schedule, ScheduleParticipant, Settings, TripBoard } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";

const DB_NAME = "grafik-bdz";
const DB_VERSION = 2;

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("schedules")) d.createObjectStore("schedules", { keyPath: "id" });
        if (!d.objectStoreNames.contains("trips")) d.createObjectStore("trips", { keyPath: "id" });
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      },
    });
  }
  return dbp;
}

// ─── Настройки ──────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<Settings> {
  try {
    const s = (await (await db()).get("meta", "settings")) as Settings | undefined;
    if (!s) return DEFAULT_SETTINGS;
    // Обединяване с подразбиращите се стойности — за съвместимост при обновяване.
    return { ...DEFAULT_SETTINGS, ...s, codes: s.codes?.length ? s.codes : DEFAULT_SETTINGS.codes };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put("meta", s, "settings");
}

// ─── Справочник на бригадата ────────────────────────────────────────────────

export async function loadRoster(): Promise<Roster> {
  try {
    const r = (await (await db()).get("meta", "roster")) as Roster | undefined;
    return r ?? { employees: [], updatedAt: new Date().toISOString() };
  } catch {
    return { employees: [], updatedAt: new Date().toISOString() };
  }
}

export async function saveRoster(r: Roster): Promise<void> {
  await (await db()).put("meta", r, "roster");
}

// ─── Графици ────────────────────────────────────────────────────────────────

/**
 * Стар формат (до разделянето на справочник и месец): служителите бяха вградени
 * в самия график. Изважда ги в справочника и оставя само участието им в месеца.
 */
type LegacySchedule = Omit<Schedule, "participants"> & {
  employees?: (RosterEmployee & ScheduleParticipant & { carryOver: number })[];
  participants?: ScheduleParticipant[];
  header: Schedule["header"] & { workingDays?: number };
};

export function migrateSchedule(raw: LegacySchedule): { schedule: Schedule; roster: RosterEmployee[] } {
  if (raw.participants) {
    const { workingDays: _drop, ...header } = raw.header;
    void _drop;
    return { schedule: { ...raw, header, participants: raw.participants } as Schedule, roster: [] };
  }

  const legacy = raw.employees ?? [];
  const roster: RosterEmployee[] = legacy.map((e) => ({
    id: e.id,
    serviceNo: e.serviceNo,
    name: e.name,
    position: e.position,
    annualLeaveDays: e.annualLeaveDays,
    dailyNorm: e.dailyNorm,
    active: true,
  }));
  const participants: ScheduleParticipant[] = legacy.map((e) => ({
    employeeId: e.id,
    carryOver: e.carryOver ?? 0,
    acknowledged: e.acknowledged ?? false,
    acknowledgedAt: e.acknowledgedAt,
  }));
  const { workingDays: _drop, ...header } = raw.header;
  void _drop;

  return {
    schedule: {
      id: raw.id,
      header,
      participants,
      cells: raw.cells ?? {},
      status: raw.status ?? "draft",
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    },
    roster,
  };
}

/** Слива нови записи в справочника, без да губи вече съществуващите. */
export function mergeRoster(existing: RosterEmployee[], incoming: RosterEmployee[]): RosterEmployee[] {
  const out = [...existing];
  for (const e of incoming) {
    if (!out.some((x) => x.id === e.id)) out.push(e);
  }
  return out;
}

export async function loadSchedule(id: string): Promise<Schedule | undefined> {
  const raw = (await (await db()).get("schedules", id)) as LegacySchedule | undefined;
  if (!raw) return undefined;
  const { schedule, roster } = migrateSchedule(raw);
  if (roster.length) {
    const cur = await loadRoster();
    await saveRoster({ employees: mergeRoster(cur.employees, roster), updatedAt: new Date().toISOString() });
    await saveSchedule(schedule);
  }
  return schedule;
}

export async function saveSchedule(s: Schedule): Promise<void> {
  await (await db()).put("schedules", s);
}

export async function deleteSchedule(id: string): Promise<void> {
  await (await db()).delete("schedules", id);
}

/** Списък само с идентификаторите — за календара, без миграция на всеки запис. */
export async function listScheduleIds(): Promise<string[]> {
  const keys = (await (await db()).getAllKeys("schedules")) as string[];
  return keys.sort((a, b) => b.localeCompare(a));
}

export async function listSchedules(): Promise<Schedule[]> {
  const ids = await listScheduleIds();
  const out: Schedule[] = [];
  for (const id of ids) {
    const s = await loadSchedule(id);
    if (s) out.push(s);
  }
  return out;
}

// ─── Рейси ──────────────────────────────────────────────────────────────────

export async function loadTrips(id: string): Promise<TripBoard | undefined> {
  return (await (await db()).get("trips", id)) as TripBoard | undefined;
}

export async function saveTrips(t: TripBoard): Promise<void> {
  await (await db()).put("trips", t);
}

export async function listTripBoards(): Promise<TripBoard[]> {
  return (await (await db()).getAll("trips")) as TripBoard[];
}

// ─── Архив за пренос между устройства (D.8) ─────────────────────────────────

export type Backup = {
  format: "grafik-bdz";
  version: 1 | 2;
  exportedAt: string;
  settings: Settings;
  roster?: Roster;
  schedules: Schedule[];
  trips: TripBoard[];
};

export async function exportAll(): Promise<Backup> {
  return {
    format: "grafik-bdz",
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: await loadSettings(),
    roster: await loadRoster(),
    schedules: await listSchedules(),
    trips: await listTripBoards(),
  };
}

export async function importAll(
  data: unknown,
  mode: "replace" | "merge" = "merge",
): Promise<{ schedules: number; trips: number; employees: number }> {
  const b = data as Backup;
  if (!b || b.format !== "grafik-bdz") {
    throw new Error('Файлът не е архив на приложението (очаква се format: "grafik-bdz").');
  }
  const d = await db();
  if (mode === "replace") {
    await d.clear("schedules");
    await d.clear("trips");
    await saveRoster({ employees: [], updatedAt: new Date().toISOString() });
  }

  // Архивите от първата версия носят служителите вградени в графиците.
  let roster = (await loadRoster()).employees;
  if (b.roster?.employees?.length) roster = mergeRoster(roster, b.roster.employees);

  for (const raw of b.schedules ?? []) {
    const { schedule, roster: extracted } = migrateSchedule(raw as LegacySchedule);
    if (extracted.length) roster = mergeRoster(roster, extracted);
    await d.put("schedules", schedule);
  }
  await saveRoster({ employees: roster, updatedAt: new Date().toISOString() });

  for (const t of b.trips ?? []) await d.put("trips", t);
  if (b.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...b.settings });

  return { schedules: b.schedules?.length ?? 0, trips: b.trips?.length ?? 0, employees: roster.length };
}
