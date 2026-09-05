"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { calcTrip, validateTrips } from "@/lib/trips";
import { formatDateTimeBG, formatHours } from "@/lib/time";
import type { Trip } from "@/lib/types";
import TripEditor, { MODE_LABEL } from "@/components/trips/TripEditor";
import ValidationPanel from "@/components/schedule/ValidationPanel";

function newTrip(employeeId: string, year: number, month: number): Trip {
  const start = new Date(year, month - 1, new Date().getDate() <= 28 ? new Date().getDate() : 1, 6, 0);
  return {
    id: `t${Date.now().toString(36)}`,
    employeeId,
    mode: "named",
    international: false,
    yavka: start.toISOString(),
    release: new Date(start.getTime() + 10 * 3600000).toISOString(),
    restRoom: true,
  };
}

export default function ReisovePage() {
  const { schedule, employees, tripBoard, settings, addTrip } = useApp();
  const [editing, setEditing] = useState<string | null>(null);

  const trips = tripBoard?.trips ?? [];
  const violations = useMemo(
    () => (schedule ? validateTrips(trips, employees, settings) : []),
    [trips, employees, schedule, settings],
  );
  const vByTrip = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of violations) if (v.tripId && v.severity === "error") m.set(v.tripId, (m.get(v.tripId) ?? 0) + 1);
    return m;
  }, [violations]);

  if (!schedule) return null;
  const editingTrip = trips.find((t) => t.id === editing);

  const sorted = [...trips].sort((a, b) => a.yavka.localeCompare(b.yavka));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0, marginRight: "auto" }}>
          Рейси (повески) — {schedule.header.brigade}
        </h1>
        <button
          className="btn btn-primary"
          disabled={employees.length === 0}
          onClick={() => {
            const t = newTrip(employees[0].id, schedule.header.year, schedule.header.month);
            addTrip(t);
            setEditing(t.id);
          }}
        >
          + Повеска
        </button>
      </div>

      {employees.length === 0 && (
        <div className="card" style={{ padding: 20, color: "var(--text-dim)" }}>
          Първо добавете служители в модул „Смени“.
        </div>
      )}

      {sorted.length === 0 && employees.length > 0 && (
        <div className="card" style={{ padding: 20, color: "var(--text-dim)" }}>
          Няма въведени повески за този месец. Повеската е цялата смяна на пътуващия
          персонал: явка → натам → почивка в оборотния пункт → обратно → освобождаване.
        </div>
      )}

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {sorted.map((t) => {
          const c = calcTrip(t, settings);
          const emp = employees.find((e) => e.id === t.employeeId);
          const errs = vByTrip.get(t.id) ?? 0;
          return (
            <button
              key={t.id}
              className="card"
              style={{
                padding: 10, textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--text)",
                borderColor: errs ? "var(--error)" : "var(--border)", borderWidth: errs ? 2 : 1.5,
              }}
              onClick={() => setEditing(t.id)}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{emp?.name || "—"}</strong>
                <span className="chip" style={{ fontSize: 10 }}>{MODE_LABEL[t.mode]}</span>
                {t.international && <span className="chip chip-accent" style={{ fontSize: 10 }}>международен</span>}
                {errs > 0 && <span className="chip chip-error" style={{ fontSize: 10 }}>{errs} нарушения</span>}
              </div>
              {t.route && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t.route}</div>}
              <div className="num" style={{ fontSize: 12, marginTop: 6 }}>
                {formatDateTimeBG(t.yavka)} → {formatDateTimeBG(t.release)}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
                <span>натам <b className="num">{c.outHours === null ? "—" : formatHours(c.outHours)}</b></span>
                <span>оборот <b className="num">{c.turnaroundHours === null ? "—" : formatHours(c.turnaroundHours)}</b></span>
                <span>обратно <b className="num">{c.backHours === null ? "—" : formatHours(c.backHours)}</b></span>
                <span style={{ marginLeft: "auto" }}>раб. <b className="num" style={{ color: "var(--text)" }}>{formatHours(c.workHours)}</b> ч.</span>
              </div>
            </button>
          );
        })}
      </div>

      <ValidationPanel
        violations={violations}
        employees={employees}
        title="Правна проверка на повеските"
        onGoTo={(_, __) => undefined}
      />

      <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 14, maxWidth: 780 }}>
        Модулът е построен по текста на Наредба № 50 (чл.13–17, чл.16а/17а/17б) и още не
        е сверен с реален бланк за локомотивни бригади. Числените граници са законовите;
        структурата на назначението (именен график / безизвикателна система / по извикване)
        следва общата отраслова практика.
      </p>

      {editingTrip && <TripEditor trip={editingTrip} onClose={() => setEditing(null)} />}
    </div>
  );
}
