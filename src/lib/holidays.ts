/**
 * Официални празници в България (чл.154 от Кодекса на труда).
 *
 * Нужни са на две места:
 *  1. РАБОТНИ ДНИ / НОРМА — празникът, паднал се в делничен ден, не е работен и
 *     затова се изважда веднъж от нормата. За септември 2026 г. календарните
 *     делнични дни са 22, но 7 и 22 септември са неработни, откъдето излизат
 *     20 работни дни и норма 160 часа — точно както в реалния бланк.
 *  2. Труд в празничен ден — заплаща се не по-малко от удвоения размер
 *     (чл.264 КТ), затова часовете се отчитат отделно.
 *
 * Вграденият списък се смята за всяка година; потребителят може да го поправи
 * (премествания със заповед на МС, добавени еднократни неработни дни).
 */

export type HolidayEntry = {
  /** ISO дата "YYYY-MM-DD". */
  date: string;
  name: string;
  /** Изрично обявен за работен — маха вграден празник. */
  removed?: boolean;
};

/** Православният Великден по Мéeus (юлианска пасхалия) — връща григорианска дата. */
export function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3 = март, 4 = април
  const day = ((d + e + 114) % 31) + 1;
  // Юлианска → григорианска дата (+13 дни за XX–XXI век).
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian;
}

const FIXED: [number, number, string][] = [
  [1, 1, "Нова година"],
  [3, 3, "Ден на Освобождението"],
  [5, 1, "Ден на труда"],
  [5, 6, "Гергьовден, Ден на храбростта"],
  [5, 24, "Ден на светите братя Кирил и Методий"],
  [9, 6, "Съединение на България"],
  [9, 22, "Ден на независимостта"],
  [12, 24, "Бъдни вечер"],
  [12, 25, "Рождество Христово"],
  [12, 26, "Рождество Христово"],
];

const key = (y: number, m: number, d: number) => `${y}-${m}-${d}`;
const keyOf = (d: Date) => key(d.getFullYear(), d.getMonth() + 1, d.getDate());

/** "2026-09-07" → "2026-9-7" */
export function isoToKey(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return key(y, m, d);
}

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Вградените неработни дни за годината: празниците плюс премествания по
 * чл.154 ал.2 — когато официален празник (извън великденските дни) се падне в
 * събота или неделя, следващият или следващите два работни дни са неприсъствени.
 */
export function builtinHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>();

  const easter = orthodoxEaster(year);
  const easterLocal = new Date(year, easter.getUTCMonth(), easter.getUTCDate());
  const addDays = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  // Велики петък, Велика събота, Великден, Светли понеделник — без преместване.
  out.set(keyOf(addDays(easterLocal, -2)), "Велики петък");
  out.set(keyOf(addDays(easterLocal, -1)), "Велика събота");
  out.set(keyOf(easterLocal), "Великден");
  out.set(keyOf(addDays(easterLocal, 1)), "Велики понеделник");

  for (const [m, d, name] of FIXED) {
    const date = new Date(year, m - 1, d);
    out.set(keyOf(date), name);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) {
      let shift = dow === 6 ? 2 : 1;
      let moved = addDays(date, shift);
      while (out.has(keyOf(moved)) || moved.getDay() === 0 || moved.getDay() === 6) {
        shift++;
        moved = addDays(date, shift);
      }
      out.set(keyOf(moved), `${name} (преместен)`);
    }
  }
  return out;
}

// ─── Ръчни поправки ─────────────────────────────────────────────────────────

let overrides: Record<string, HolidayEntry[]> = {};
const cache = new Map<number, Map<string, string>>();

/**
 * Задава поправките от настройките. Държим ги в модула, а не ги подаваме през
 * всяка функция, защото производственият календар се ползва навсякъде —
 * от изчисленията до заглавията на колоните. Викa се при зареждане на
 * настройките и при всяка тяхна промяна; кешът се изчиства.
 */
export function setHolidayOverrides(o: Record<string, HolidayEntry[]> | undefined): void {
  overrides = o ?? {};
  cache.clear();
}

export function getHolidayOverrides(): Record<string, HolidayEntry[]> {
  return overrides;
}

/**
 * Неработните дни за годината по конкретен набор поправки — без да се пипа
 * състоянието на модула. Ползва се от редактора на календара в настройките,
 * който показва още незаписана чернова.
 */
export function holidaysWith(
  year: number,
  o: Record<string, HolidayEntry[]>,
): Map<string, string> {
  const map = builtinHolidays(year);
  for (const e of o[String(year)] ?? []) {
    const k = isoToKey(e.date);
    if (e.removed) map.delete(k);
    else map.set(k, e.name);
  }
  return map;
}

/** Действащите неработни дни за годината: вградените плюс ръчните поправки. */
export function holidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const map = holidaysWith(year, overrides);
  cache.set(year, map);
  return map;
}

export function holidayName(year: number, month: number, day: number): string | null {
  return holidays(year).get(key(year, month, day)) ?? null;
}

export function isHoliday(year: number, month: number, day: number): boolean {
  return holidays(year).has(key(year, month, day));
}

/** Пълен списък за редактора в настройките. */
export type HolidayRow = {
  date: string; // ISO
  name: string;
  builtin: boolean;
  /** Вграден празник, изрично обявен за работен. */
  removed: boolean;
};

export function listHolidays(
  year: number,
  o: Record<string, HolidayEntry[]> = overrides,
): HolidayRow[] {
  const base = builtinHolidays(year);
  const rows = new Map<string, HolidayRow>();

  for (const [k, name] of base) {
    const [y, m, d] = k.split("-").map(Number);
    rows.set(k, { date: toIso(y, m, d), name, builtin: true, removed: false });
  }
  for (const e of o[String(year)] ?? []) {
    const k = isoToKey(e.date);
    const existing = rows.get(k);
    if (e.removed) {
      if (existing) rows.set(k, { ...existing, removed: true });
    } else {
      rows.set(k, { date: e.date, name: e.name, builtin: existing?.builtin ?? false, removed: false });
    }
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
