"use client";

import { useMemo, useState } from "react";
import type { Employee, Violation } from "@/lib/types";
import { SeverityDot } from "@/components/ui";

export default function ValidationPanel({
  violations,
  employees,
  onGoTo,
  title = "Правна проверка",
}: {
  violations: Violation[];
  employees: Employee[];
  onGoTo?: (employeeId: string, day?: number) => void;
  title?: string;
}) {
  const [filter, setFilter] = useState<"all" | "error" | "warning">("all");
  const [open, setOpen] = useState(true);

  const counts = useMemo(() => ({
    error: violations.filter((v) => v.severity === "error").length,
    warning: violations.filter((v) => v.severity === "warning").length,
    info: violations.filter((v) => v.severity === "info").length,
  }), [violations]);

  const shown = useMemo(
    () => violations.filter((v) => (filter === "all" ? true : v.severity === filter)),
    [violations, filter],
  );

  const nameOf = (id?: string) => employees.find((e) => e.id === id)?.name || "—";

  return (
    <div className="card no-print" style={{ marginTop: 10 }}>
      <div className="hairline" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span className={counts.error ? "chip chip-error" : "chip chip-ok"}>
          {counts.error ? `${counts.error} нарушения` : "без нарушения"}
        </span>
        {counts.warning > 0 && <span className="chip chip-warn">{counts.warning} предупреждения</span>}
        {counts.info > 0 && <span className="chip">{counts.info} бележки</span>}

        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {(["all", "error", "warning"] as const).map((f) => (
            <button
              key={f}
              className="btn btn-sm"
              style={{ background: filter === f ? "var(--accent)" : "var(--surface)", color: filter === f ? "var(--accent-ink)" : "var(--text)" }}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Всички" : f === "error" ? "Нарушения" : "Предупр."}
            </button>
          ))}
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? "Скрий" : "Покажи"}</button>
        </div>
      </div>

      {open && (
        <div className="scroll-y" style={{ maxHeight: 260 }}>
          {shown.length === 0 && (
            <div style={{ padding: 14, color: "var(--text-dim)", fontSize: 13 }}>
              Няма записи по този филтър.
            </div>
          )}
          {shown.map((v) => (
            <button
              key={v.id}
              className="hairline"
              style={{
                display: "flex", gap: 8, width: "100%", textAlign: "left", padding: "8px 12px",
                background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                cursor: onGoTo ? "pointer" : "default", font: "inherit", color: "var(--text)",
              }}
              onClick={() => v.employeeId && onGoTo?.(v.employeeId, v.day)}
            >
              <SeverityDot severity={v.severity} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                  <span className="num" style={{ fontSize: 11, color: "var(--accent-text)", fontWeight: 800 }}>{v.article}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{nameOf(v.employeeId)}</span>
                  {v.day !== undefined && <span className="num" style={{ fontSize: 11, color: "var(--text-dim)" }}>ден {v.day}</span>}
                </span>
                <span style={{ display: "block", fontSize: 13, marginTop: 2 }}>{v.message}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
