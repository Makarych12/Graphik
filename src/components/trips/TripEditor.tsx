"use client";

import { Modal, Field } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Trip, TripMode } from "@/lib/types";
import { calcTrip, nextAllowedYavka } from "@/lib/trips";
import { formatDateTimeBG, formatHours, fromLocalInput, toLocalInput } from "@/lib/time";
import Dropdown from "@/components/Dropdown";

const MODE_LABEL: Record<TripMode, string> = {
  named: "Именен график",
  callless: "Безизвикателна система",
  oncall: "По извикване",
};

export default function TripEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { schedule, employees, settings, updateTrip, removeTrip } = useApp();
  if (!schedule) return null;

  const set = (patch: Partial<Trip>) => updateTrip(trip.id, patch);
  const c = calcTrip(trip, settings);
  const next = trip.release ? nextAllowedYavka(trip, settings) : null;

  return (
    <Modal open onClose={onClose} wide title="Повеска">
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <Field label="Служител">
          <Dropdown
            value={trip.employeeId}
            ariaLabel="Служител"
            options={employees.map((e) => ({ value: e.id, label: e.name || e.serviceNo || "без име" }))}
            onChange={(v) => set({ employeeId: v })}
          />
        </Field>
        <Field label="Режим на назначение">
          <Dropdown
            value={trip.mode}
            ariaLabel="Режим на назначение"
            options={(Object.keys(MODE_LABEL) as TripMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            onChange={(v) => set({ mode: v as TripMode })}
          />
        </Field>
        <Field label="Маршрут">
          <input className="input" value={trip.route ?? ""} onChange={(e) => set({ route: e.target.value })} placeholder="напр. Г. Оряховица – Варна" />
        </Field>

        <Field label="Явка">
          <input className="input num" type="datetime-local" value={toLocalInput(trip.yavka)} onChange={(e) => set({ yavka: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Пристигане в оборотния пункт">
          <input className="input num" type="datetime-local" value={toLocalInput(trip.arrivalTurnaround)} onChange={(e) => set({ arrivalTurnaround: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Отправяне от оборотния пункт">
          <input className="input num" type="datetime-local" value={toLocalInput(trip.departureTurnaround)} onChange={(e) => set({ departureTurnaround: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Освобождаване">
          <input className="input num" type="datetime-local" value={toLocalInput(trip.release)} onChange={(e) => set({ release: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Почивка в повеската (мин.)" hint="чл.17б — при международни превози.">
          <input className="input num" inputMode="numeric" value={trip.breakMinutes ?? ""} onChange={(e) => set({ breakMinutes: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Управление натам (ч.)">
          <input className="input num" inputMode="decimal" value={trip.drivingOut ?? ""} onChange={(e) => set({ drivingOut: Number(e.target.value.replace(",", ".")) || 0 })} />
        </Field>
        <Field label="Управление обратно (ч.)">
          <input className="input num" inputMode="decimal" value={trip.drivingBack ?? ""} onChange={(e) => set({ drivingBack: Number(e.target.value.replace(",", ".")) || 0 })} />
        </Field>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {([
          ["restRoom", "Има стая за отдих в оборотния пункт (чл.17)"],
          ["secondDriver", "Втори машинист в локомотива (отпада почивката по чл.17б)"],
          ["international", "Интероперативен граничен превоз — по-строгият режим (чл.16а, 17а, 17б)"],
        ] as const).map(([k, label]) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" style={{ width: 20, height: 20 }} checked={Boolean(trip[k])} onChange={(e) => set({ [k]: e.target.checked } as Partial<Trip>)} />
            {label}
          </label>
        ))}
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" style={{ width: 20, height: 20 }} checked={trip.extension?.approved ?? false}
            onChange={(e) => set({ extension: { approved: e.target.checked } })} />
          Оформено удължаване по чл.14
        </label>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 10, background: "var(--surface-2)" }}>
        <div className="ui-label" style={{ marginBottom: 6 }}>Изчисление</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, fontSize: 13 }}>
          {[
            ["Натам", c.outHours], ["Престой в оборота", c.turnaroundHours],
            ["Обратно", c.backHours], ["Работно време", c.workHours],
            ["Нощни часове", c.nightHours],
            ["Изисквана почивка в оборота", c.requiredTurnaroundRest],
          ].map(([label, v]) => (
            <div key={label as string}>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
              <div className="num" style={{ fontSize: 15 }}>{v === null || v === undefined ? "—" : `${formatHours(v as number)} ч.`}</div>
            </div>
          ))}
        </div>
        {c.turnaroundHours !== null && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
            Престоят в оборота се отчита като {c.turnaroundIsWork ? "работно време" : "почивка"} (чл.17).
          </div>
        )}
        {next && trip.mode === "callless" && (
          <div className="chip chip-accent" style={{ marginTop: 8, height: "auto", padding: "6px 10px", whiteSpace: "normal" }}>
            Безизвикателна система: най-ранна следваща явка{" "}
            <strong className="num">{formatDateTimeBG(next.iso)}</strong> (почивка {formatHours(next.restHours, 0)} ч. — {next.reason})
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={onClose}>Готово</button>
        <button className="btn btn-danger" onClick={() => { if (confirm("Да се изтрие ли повеската?")) { removeTrip(trip.id); onClose(); } }}>
          Изтрий
        </button>
      </div>
    </Modal>
  );
}

export { MODE_LABEL };
