import type { Settings, ShiftPattern, ShiftCode } from "./types";
import { daysInMonth } from "./time";

/**
 * Базови шаблони на смените (D.2.1).
 *
 * Двата шаблона дават ЧЕРНОВА разстановка при откриване на нов месец. Всичко се
 * презаписва на ръка — шаблонът не заключва нито един ден.
 *
 * Официалните празници НЕ прекъсват шаблона: в БДЖ се работи и в празник,
 * производството е непрекъснато. Денят си остава работен по цикъла, а
 * удвоеното заплащане по чл.264 КТ се начислява автоматично (виж calc.ts).
 */

const DAY = 86400000;

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Брой цели денонощия от опорната дата до дадения ден (без часови пояси). */
function daysFromAnchor(anchor: string, year: number, month: number, day: number): number {
  const [ay, am, ad] = anchor.split("-").map(Number);
  if (!ay || !am || !ad) return 0;
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(ay, am - 1, ad)) / DAY);
}

/** Кой код се пада на този ден по шаблона; null = почивен ден по шаблона. */
export function patternCodeIdFor(
  pattern: ShiftPattern | undefined,
  year: number,
  month: number,
  day: number,
): string | null {
  if (!pattern || pattern.kind === "none") return null;

  if (pattern.kind === "weekdays") {
    const dow = new Date(year, month - 1, day).getDay();
    // Само събота и неделя са почивни. Празникът в делничен ден остава работен.
    return dow >= 1 && dow <= 5 ? pattern.codeId : null;
  }

  const codes = pattern.codeIds.filter(Boolean);
  if (!codes.length) return null;
  const cycle = codes.length * 4; // за всеки код: 2 работни + 2 почивни
  const offset = mod(daysFromAnchor(pattern.anchor, year, month, day), cycle);
  const block = Math.floor(offset / 4);
  return offset % 4 < 2 ? codes[block] : null;
}

/** Разстановката на един служител за целия месец по шаблона му. */
export function patternMonth(
  pattern: ShiftPattern | undefined,
  year: number,
  month: number,
): Record<number, string> {
  const out: Record<number, string> = {};
  if (!pattern || pattern.kind === "none") return out;
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const codeId = patternCodeIdFor(pattern, year, month, d);
    if (codeId) out[d] = codeId;
  }
  return out;
}

// ─── Описание за интерфейса ─────────────────────────────────────────────────

export const PATTERN_LABEL: Record<ShiftPattern["kind"], string> = {
  none: "Без шаблон (ръчно)",
  cycle2x2: "Цикъл 2 през 2 (дневни смени)",
  weekdays: "Редовна смяна пон.–пет.",
};

function codeLabel(settings: Settings, id: string): string {
  const c: ShiftCode | undefined = settings.codes.find((x) => x.id === id);
  return c ? c.code : "?";
}

export function describePattern(pattern: ShiftPattern | undefined, settings: Settings): string {
  if (!pattern || pattern.kind === "none") return PATTERN_LABEL.none;
  if (pattern.kind === "weekdays") {
    return `Редовна смяна пон.–пет. (код ${codeLabel(settings, pattern.codeId)})`;
  }
  const codes = pattern.codeIds.map((id) => codeLabel(settings, id)).join(" / ");
  const [y, m, d] = pattern.anchor.split("-");
  return `2 през 2, кодове ${codes}, от ${d}.${m}.${y}`;
}

/** Шаблон по подразбиране при избор на вид — с разумни кодове от легендата. */
export function defaultPattern(kind: ShiftPattern["kind"], settings: Settings, anchor: string): ShiftPattern {
  const byCode = (c: string) => settings.codes.find((x) => x.code === c)?.id;
  if (kind === "weekdays") {
    return { kind: "weekdays", codeId: byCode("3") ?? settings.codes[0]?.id ?? "" };
  }
  if (kind === "cycle2x2") {
    const one = byCode("1");
    return { kind: "cycle2x2", anchor, codeIds: one ? [one] : [] };
  }
  return { kind: "none" };
}
