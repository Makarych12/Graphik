import { isHoliday } from "./holidays";

export { holidayName, isHoliday } from "./holidays";

/** Помощни функции за време. Всичко се смята в минути от началото на смяната. */

export function parseHM(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + (m || 0);
}

export function formatHM(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Часове с 2 знака, както в бланка: 8,00 / -352,00 */
export function formatHours(h: number, digits = 2): string {
  return h.toFixed(digits).replace(".", ",");
}

/** Продължителност start→end в минути; ако end <= start, смяната минава през полунощ. */
export function spanMinutes(start: string, end: string): number {
  const s = parseHM(start);
  const e = parseHM(end);
  return e > s ? e - s : e + 1440 - s;
}

/** Сумарна продължителност на прекъсванията в минути. */
export function breaksMinutes(breaks: { start: string; end: string }[]): number {
  return breaks.reduce((acc, b) => acc + spanMinutes(b.start, b.end), 0);
}

/**
 * Припокриване на интервал [aStart,aEnd) с нощния прозорец [nightStart,nightEnd)
 * в минути. Интервалите се задават в минути от началото на денонощието,
 * като aEnd може да надхвърля 1440 (смяна през полунощ).
 */
export function nightOverlapMinutes(
  aStart: number,
  aEnd: number,
  nightStart: string,
  nightEnd: string,
): number {
  const ns = parseHM(nightStart);
  const ne = parseHM(nightEnd);
  // Нощният прозорец като поредица от интервали, повторени за 3 денонощия,
  // за да покрие смени, започващи вечерта и завършващи на другия ден.
  let total = 0;
  for (let day = -1; day <= 2; day++) {
    const off = day * 1440;
    // Прозорецът 22:00→06:00 се разпада на [ns, 1440) и [0, ne) на следващия ден,
    // което в разгънат вид е просто [ns+off, ne+off+1440) когато ne < ns.
    const ws = ns + off;
    const we = ne <= ns ? ne + off + 1440 : ne + off;
    total += Math.max(0, Math.min(aEnd, we) - Math.max(aStart, ws));
  }
  return total;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const WEEKDAY_BG = ["н", "п", "в", "с", "ч", "п", "с"];
const WEEKDAY_BG_FULL = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];

export function weekdayLetter(year: number, month: number, day: number): string {
  return WEEKDAY_BG[new Date(year, month - 1, day).getDay()];
}

export function weekdayName(year: number, month: number, day: number): string {
  return WEEKDAY_BG_FULL[new Date(year, month - 1, day).getDay()];
}

export function isWeekend(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day).getDay();
  return d === 0 || d === 6;
}

export const MONTHS_BG = [
  "януари", "февруари", "март", "април", "май", "юни",
  "юли", "август", "септември", "октомври", "ноември", "декември",
];

/** ISO номер на седмицата — за контрола на седмичната норма. */
export function isoWeek(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Брой работни дни в месеца по производствения календар: делничните дни без
 * официалните празници по чл.154 от КТ (включително преместените).
 */
export function countWorkingDays(year: number, month: number): number {
  let n = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    if (!isWeekend(year, month, d) && !isHoliday(year, month, d)) n++;
  }
  return n;
}

/** Неработен ден: събота, неделя или официален празник. */
export function isNonWorking(year: number, month: number, day: number): boolean {
  return isWeekend(year, month, day) || isHoliday(year, month, day);
}

export function scheduleId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Разлика между два ISO datetime-а в часове. */
export function hoursBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

export function formatDateTimeBG(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function addHours(iso: string, h: number): string {
  return new Date(new Date(iso).getTime() + h * 3600000).toISOString();
}

/** ISO → стойност за <input type="datetime-local"> в местно време. */
export function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Стойност от <input type="datetime-local"> → ISO. */
export function fromLocalInput(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
