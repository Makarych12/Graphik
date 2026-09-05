"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Cell } from "@/lib/types";
import { formatHours } from "@/lib/time";

export default function CodePicker({
  open,
  onClose,
  employeeId,
  day,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string | null;
  day: number | null;
}) {
  const { settings, schedule, employees, setCell, fillRange } = useApp();
  const [rangeTo, setRangeTo] = useState<string>("");

  const employee = employees.find((e) => e.id === employeeId);
  const current: Cell | null =
    employeeId && day ? (schedule?.cells[employeeId]?.[day] ?? null) : null;
  const currentCode = settings.codes.find((c) => c.id === current?.codeId);

  const groups = useMemo(() => ({
    work: settings.codes.filter((c) => c.category === "work"),
    rest: settings.codes.filter((c) => c.category !== "work"),
  }), [settings.codes]);

  if (!employeeId || !day) return null;

  const apply = (codeId: string | null) => {
    const to = rangeTo ? parseInt(rangeTo, 10) : null;
    if (to && to !== day) fillRange(employeeId, day, to, codeId);
    else setCell(employeeId, day, codeId ? { ...current, codeId } : null);
    setRangeTo("");
    onClose();
  };

  const toggleExtension = () => {
    if (!current) return;
    setCell(employeeId, day, {
      ...current,
      extension: { approved: !(current.extension?.approved ?? false) },
    });
  };

  return (
    <Modal open={open} onClose={onClose} wide title={`${employee?.name || "Служител"} — ${day} число`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="ui-label">Попълни до ден</span>
          <input
            className="input num"
            style={{ width: 90 }}
            inputMode="numeric"
            placeholder="—"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value.replace(/\D/g, ""))}
          />
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            празно = само този ден
          </span>
        </div>

        <div>
          <div className="ui-label" style={{ marginBottom: 6 }}>Работни кодове</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
            {groups.work.map((c) => (
              <button
                key={c.id}
                className="btn"
                style={{
                  justifyContent: "flex-start", height: 52, textAlign: "left",
                  borderLeft: `6px solid ${c.color}`,
                  background: current?.codeId === c.id ? "var(--accent-soft)" : "var(--surface)",
                  borderColor: current?.codeId === c.id ? "var(--accent)" : "var(--border-strong)",
                }}
                onClick={() => apply(c.id)}
              >
                <span className="num" style={{ fontSize: 18, minWidth: 26 }}>{c.code}</span>
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, overflow: "hidden" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                  <span className="num" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {c.start && c.end ? `${c.start}–${c.end} · ${formatHours(c.hours ?? 0, 0)} ч.` : "по норма"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="ui-label" style={{ marginBottom: 6 }}>Отпуски и отсъствия</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
            {groups.rest.map((c) => (
              <button
                key={c.id}
                className="btn"
                style={{
                  justifyContent: "flex-start", height: 44, textAlign: "left",
                  borderLeft: `6px solid ${c.color}`,
                  background: current?.codeId === c.id ? "var(--accent-soft)" : "var(--surface)",
                  borderColor: current?.codeId === c.id ? "var(--accent)" : "var(--border-strong)",
                }}
                onClick={() => apply(c.id)}
              >
                <span className="num" style={{ fontSize: 16, minWidth: 30 }}>{c.code}</span>
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {currentCode?.category === "work" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <input
              type="checkbox"
              style={{ width: 20, height: 20 }}
              checked={current?.extension?.approved ?? false}
              onChange={toggleExtension}
            />
            Оформено удължаване по чл.14 (телефонограма + писмена заповед)
          </label>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => apply(null)}>
            Изчисти клетката
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Отказ</button>
        </div>
      </div>
    </Modal>
  );
}
