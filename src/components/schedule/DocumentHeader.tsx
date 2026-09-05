"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";
import { Field } from "@/components/ui";
import { MONTHS_BG, countWorkingDays, formatHours } from "@/lib/time";

/**
 * Шапка на документа (C.1). Всички полета са свободно редактируеми (D.8.1) —
 * нищо не е зашито твърдо за конкретно депо или район.
 */
export default function DocumentHeader() {
  const { schedule, updateHeader, recomputeNorm } = useApp();
  const [edit, setEdit] = useState(false);
  if (!schedule) return null;
  const h = schedule.header;

  // Работните дни по производствения календар са само справка: РАБОТНИ ДНИ вече
  // не е общо поле на бланката — всеки служител има свои фактически дни, които
  // се смятат на реда му.
  const calendarDays = countWorkingDays(h.year, h.month);
  const normMatches = Math.abs(h.normHours - calendarDays * 8) < 0.01;

  return (
    <div className="card doc-header" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 700 }}>{h.organization}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{h.department}</div>
          <h1 style={{ margin: "6px 0 2px", fontSize: 17, fontWeight: 800, lineHeight: 1.25 }}>
            ГРАФИК за работното време на {h.brigade}
          </h1>
          <div className="num" style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {MONTHS_BG[h.month - 1]} {h.year} г.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div className="ui-label">Норма /часове/</div>
            <div className="num doc-figure" style={{ fontSize: 22, fontWeight: 800 }}>{formatHours(h.normHours, 0)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="ui-label">Работни дни по календар</div>
            <div className="num doc-figure" style={{ fontSize: 22, fontWeight: 800, color: "var(--text-dim)" }}>{calendarDays}</div>
            <div style={{ fontSize: 10, color: "var(--text-faint)", maxWidth: 150 }}>
              справка; фактическите дни са на реда на всеки служител
            </div>
          </div>
        </div>

        <button className="btn btn-sm no-print" onClick={() => setEdit(!edit)}>
          {edit ? "Готово" : "Редактирай шапката"}
        </button>
      </div>

      {edit && (
        <div className="no-print" style={{ marginTop: 12, borderTop: "1.5px solid var(--border)", paddingTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          <Field label="Организация / поделение">
            <input className="input" value={h.organization} onChange={(e) => updateHeader({ organization: e.target.value })} />
          </Field>
          <Field label="Депо / район">
            <input className="input" value={h.department} onChange={(e) => updateHeader({ department: e.target.value })} />
          </Field>
          <Field label="Бригада / група">
            <input className="input" value={h.brigade} onChange={(e) => updateHeader({ brigade: e.target.value })} />
          </Field>
          <Field
            label="Норма /часове/"
            hint={
              normMatches
                ? `Съвпада с производствения календар: ${calendarDays} дни × 8 ч.`
                : `По календар излизат ${calendarDays} дни × 8 ч. = ${calendarDays * 8} ч.`
            }
          >
            <input className="input num" inputMode="decimal" value={h.normHours}
              onChange={(e) => updateHeader({ normHours: Number(e.target.value.replace(",", ".")) || 0 })} />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              className="btn"
              disabled={normMatches}
              onClick={recomputeNorm}
              title="Връща нормата към производствения календар: делнични дни без официалните празници по чл.154 КТ, по 8 часа."
            >
              Пресметни по календар
            </button>
          </div>

          {(["preparedBy", "agreedBy", "approvedBy"] as const).map((k, i) => (
            <div key={k} style={{ display: "grid", gap: 6 }}>
              <div className="ui-label">{["Изготвил", "Съгласувал", "Утвърдил"][i]}</div>
              <input className="input" placeholder="Име и фамилия" value={h[k].name}
                onChange={(e) => updateHeader({ [k]: { ...h[k], name: e.target.value } })} />
              <input className="input" placeholder="Длъжност" value={h[k].position}
                onChange={(e) => updateHeader({ [k]: { ...h[k], position: e.target.value } })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Блок с подписите — долната част на бланка (C.1). */
export function SignatureBlock() {
  const schedule = useApp((s) => s.schedule);
  if (!schedule) return null;
  const h = schedule.header;
  const rows = [
    { label: "Изготвил", p: h.preparedBy },
    { label: "Съгласувал", p: h.agreedBy },
    { label: "Утвърдил", p: h.approvedBy },
  ];
  return (
    <div className="signatures" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24, marginTop: 18 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="ui-label">{r.label}:</div>
          <div className="sig-line" style={{ borderBottom: "1.5px solid var(--border-strong)", height: 28 }} />
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
            {r.p.name || "………………………"} — {r.p.position || "………………"}
          </div>
        </div>
      ))}
    </div>
  );
}
