"use client";

import { useMemo } from "react";
import { useApp, useResolved } from "@/lib/store";
import { validateSchedule } from "@/lib/validation";
import type { ResolvedSchedule } from "@/lib/types";

/**
 * Задължителен предпросмотър преди прилагане на масови промени (D.7.1):
 * нарядчикът вижда точно кои клетки ще се сменят и как това се отразява на
 * правната проверка, и потвърждава с едно действие.
 */
export default function PatchPreview() {
  const { pendingPatch, settings, applyPendingPatch, discardPendingPatch } = useApp();
  const schedule = useResolved();

  const sim = useMemo(() => {
    if (!pendingPatch || !schedule) return null;
    const next: ResolvedSchedule = {
      ...schedule,
      header: { ...schedule.header, ...(pendingPatch.header ?? {}) },
      cells: Object.fromEntries(Object.entries(schedule.cells).map(([k, v]) => [k, { ...v }])),
    };
    for (const ch of pendingPatch.cells) {
      const row = next.cells[ch.employeeId] ?? (next.cells[ch.employeeId] = {});
      if (ch.to) row[ch.day] = ch.to;
      else delete row[ch.day];
    }
    const before = validateSchedule(schedule, settings).filter((v) => v.severity === "error").length;
    const after = validateSchedule(next, settings).filter((v) => v.severity === "error").length;
    return { before, after };
  }, [pendingPatch, schedule, settings]);

  if (!pendingPatch || !schedule) return null;

  const codeOf = (id?: string) => settings.codes.find((c) => c.id === id)?.code ?? "—";
  const nameOf = (id: string) => schedule.employees.find((e) => e.id === id)?.name || "—";

  return (
    <div
      className="card no-print"
      style={{ borderColor: "var(--accent)", borderWidth: 2, marginTop: 10, overflow: "hidden" }}
    >
      <div style={{ background: "var(--accent-soft)", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Предложение от ИИ — чака потвърждение</strong>
        <span className="chip chip-accent num">{pendingPatch.cells.length} клетки</span>
        {sim && (
          <span className={`chip ${sim.after < sim.before ? "chip-ok" : sim.after > sim.before ? "chip-error" : ""}`}>
            нарушения: {sim.before} → {sim.after}
          </span>
        )}
      </div>

      <div style={{ padding: "8px 12px", fontSize: 13 }}>{pendingPatch.summary}</div>

      {pendingPatch.header && (
        <div style={{ padding: "0 12px 8px", fontSize: 12 }}>
          <span className="ui-label">Шапка:</span>{" "}
          <span className="num">{JSON.stringify(pendingPatch.header)}</span>
        </div>
      )}

      {pendingPatch.cells.length > 0 && (
        <div className="scroll-y" style={{ maxHeight: 220, borderTop: "1px solid var(--border)" }}>
          <table className="sched-grid" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingLeft: 8 }}>Служител</th>
                <th style={{ width: 54 }}>Ден</th>
                <th style={{ width: 70 }}>Било</th>
                <th style={{ width: 70 }}>Става</th>
              </tr>
            </thead>
            <tbody>
              {pendingPatch.cells.map((c, i) => (
                <tr key={`${c.employeeId}-${c.day}-${i}`}>
                  <td style={{ padding: "0 8px", fontSize: 12, whiteSpace: "nowrap" }}>{nameOf(c.employeeId)}</td>
                  <td className="num" style={{ textAlign: "center" }}>{c.day}</td>
                  <td className="num" style={{ textAlign: "center", color: "var(--text-dim)" }}>{codeOf(c.from?.codeId)}</td>
                  <td className="num" style={{ textAlign: "center", fontWeight: 800, color: "var(--accent-text)" }}>{codeOf(c.to?.codeId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1.5px solid var(--border)" }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={applyPendingPatch}>
          Приложи промените
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={discardPendingPatch}>Откажи</button>
      </div>
    </div>
  );
}
