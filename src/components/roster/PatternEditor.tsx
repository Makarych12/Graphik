"use client";

import { useApp } from "@/lib/store";
import Dropdown from "@/components/Dropdown";
import { Field } from "@/components/ui";
import type { ShiftPattern } from "@/lib/types";
import { PATTERN_LABEL, defaultPattern, patternMonth } from "@/lib/patterns";
import { MONTHS_BG, daysInMonth, isNonWorking, weekdayLetter } from "@/lib/time";
import { isHoliday } from "@/lib/holidays";

/**
 * Базов шаблон на смените за служителя (D.2.1). Дава ЧЕРНОВА разстановка при
 * откриване на нов месец; всеки ден се презаписва на ръка.
 */
export default function PatternEditor({
  pattern,
  onChange,
}: {
  pattern: ShiftPattern | undefined;
  onChange: (p: ShiftPattern) => void;
}) {
  const { settings, schedule } = useApp();
  const year = schedule?.header.year ?? new Date().getFullYear();
  const month = schedule?.header.month ?? new Date().getMonth() + 1;
  const workCodes = settings.codes.filter((c) => c.category === "work");
  const kind = pattern?.kind ?? "none";

  const preview = patternMonth(pattern, year, month);
  const dim = daysInMonth(year, month);

  return (
    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
      <Field label="Базов шаблон на смените">
        <Dropdown
          value={kind}
          ariaLabel="Базов шаблон на смените"
          options={(Object.keys(PATTERN_LABEL) as ShiftPattern["kind"][]).map((k) => ({ value: k, label: PATTERN_LABEL[k] }))}
          onChange={(v) =>
            onChange(
              defaultPattern(
                v as ShiftPattern["kind"],
                settings,
                `${year}-${String(month).padStart(2, "0")}-01`,
              ),
            )
          }
        />
      </Field>

      {pattern?.kind === "cycle2x2" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Field
            label="Първи работен ден от цикъла"
            hint="Цикълът се брои от тази дата и продължава непрекъснато през месеците."
          >
            <input
              className="input num" type="date" value={pattern.anchor}
              onChange={(e) => onChange({ ...pattern, anchor: e.target.value })}
            />
          </Field>
          <div>
            <div className="ui-label" style={{ marginBottom: 4 }}>Кодове в цикъла</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {workCodes.map((c) => {
                const on = pattern.codeIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    className="btn btn-sm num"
                    style={{
                      minWidth: 40,
                      background: on ? "var(--accent)" : "var(--surface)",
                      color: on ? "var(--accent-ink)" : "var(--text)",
                      borderColor: on ? "var(--accent-strong)" : "var(--border)",
                    }}
                    title={`${c.code} — ${c.label}${c.start ? ` (${c.start}–${c.end})` : ""}`}
                    onClick={() =>
                      onChange({
                        ...pattern,
                        codeIds: on
                          ? pattern.codeIds.filter((x) => x !== c.id)
                          : [...pattern.codeIds, c.id],
                      })
                    }
                  >
                    {c.code}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, marginBottom: 0 }}>
              Един код — 2 работни дни и 2 у дома. Два кода — блоковете се редуват
              (напр. 2 дни I смяна, 2 почивни, 2 дни II смяна, 2 почивни).
            </p>
          </div>
        </div>
      )}

      {pattern?.kind === "weekdays" && (
        <Field label="Код на редовната смяна" hint="Понеделник–петък; събота и неделя са почивни.">
          <Dropdown
            value={pattern.codeId}
            ariaLabel="Код на редовната смяна"
            options={workCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.label}` }))}
            onChange={(v) => onChange({ ...pattern, codeId: v })}
          />
        </Field>
      )}

      {kind !== "none" && (
        <div>
          <div className="ui-label" style={{ marginBottom: 4 }}>
            Как ляга шаблонът върху {MONTHS_BG[month - 1]} {year}
          </div>
          <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {Array.from({ length: dim }, (_, i) => i + 1).map((d) => {
              const codeId = preview[d];
              const code = settings.codes.find((c) => c.id === codeId);
              const holiday = isHoliday(year, month, d);
              return (
                <span
                  key={d}
                  title={`${d} ${MONTHS_BG[month - 1]}${holiday ? " — официален празник" : ""}${code ? `: ${code.code}` : ": почивен по шаблон"}`}
                  style={{
                    width: 20, textAlign: "center", fontSize: 10, lineHeight: "20px",
                    fontFamily: "var(--mono)", fontWeight: 700,
                    background: code
                      ? `color-mix(in srgb, ${code.color} 30%, var(--surface))`
                      : isNonWorking(year, month, d) ? "var(--surface-3)" : "var(--surface-2)",
                    borderTop: holiday ? "3px solid var(--accent)" : "3px solid transparent",
                    color: "var(--text)",
                  }}
                >
                  {code ? code.code : weekdayLetter(year, month, d)}
                </span>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, marginBottom: 0 }}>
            Официалните празници (кехлибарена черта) не прекъсват шаблона — в БДЖ се
            работи и в празник, а трудът се заплаща удвоено (чл.264 КТ).
          </p>
        </div>
      )}
    </div>
  );
}
