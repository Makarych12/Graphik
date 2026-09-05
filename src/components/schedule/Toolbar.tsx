"use client";

import { useRef, useState } from "react";
import { useApp } from "@/lib/store";
import * as db from "@/lib/db";
import type { ScheduleStatus } from "@/lib/types";
import MonthRoster from "./MonthRoster";
import Dropdown from "@/components/Dropdown";

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  draft: "Чернова",
  review: "За съгласуване",
  approved: "Утвърден",
};

export default function Toolbar({ onToggleAI, aiOpen }: { onToggleAI: () => void; aiOpen: boolean }) {
  const { schedule, setStatus, applyPatterns, roster, employees } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const [composing, setComposing] = useState(false);

  if (!schedule) return null;

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  const doExport = async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `grafik-${schedule.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("Архивът е свален.");
  };

  const doImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const mode = confirm(
        "OK — заместване на всички данни в браузъра.\nОтказ — добавяне към наличните (сливане).",
      ) ? "replace" : "merge";
      const r = await db.importAll(data, mode as "replace" | "merge");
      flash(`Внесени ${r.schedules} месеца, ${r.employees} служители, ${r.trips} списъка с рейси. Презареждане…`);
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      flash(`Грешка при внасяне: ${(e as Error).message}`);
    }
  };

  return (
    <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span className="ui-label">Статус</span>
        <Dropdown
          style={{ width: "auto", minWidth: 170 }}
          value={schedule.status}
          ariaLabel="Статус на графика"
          options={(Object.keys(STATUS_LABEL) as ScheduleStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          onChange={(v) => setStatus(v as ScheduleStatus)}
        />
      </div>

      <button
        className="btn"
        title="Кой от справочника участва в този месец. Картонът на служителя се води в „Настройки → Служители“."
        onClick={() => setComposing(true)}
      >
        Състав за месеца
      </button>
      {employees.some((e) => e.pattern && e.pattern.kind !== "none") && (
        <button
          className="btn"
          title="Разстила базовите шаблони на смените върху празните дни. Ръчно въведените клетки не се пипат."
          onClick={() => {
            const n = applyPatterns();
            flash(n ? `Попълнени ${n} клетки по базовите шаблони.` : "Няма празни дни за попълване по шаблон.");
          }}
        >
          Приложи шаблоните
        </button>
      )}
      <button className="btn" onClick={() => window.print()}>Печат / PDF</button>
      <button className="btn" onClick={doExport}>Експорт JSON</button>
      <button className="btn" onClick={() => fileRef.current?.click()}>Импорт JSON</button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
      />

      <span className="chip" title="Служители в графика за този месец и общо в справочника">
        {employees.length} от {roster.length} в графика
      </span>

      <button
        className={aiOpen ? "btn btn-primary" : "btn"}
        style={{ marginLeft: "auto" }}
        onClick={onToggleAI}
      >
        ИИ-асистент
      </button>

      {msg && <span className="chip chip-accent" style={{ width: "100%" }}>{msg}</span>}
      {composing && <MonthRoster onClose={() => setComposing(false)} />}
    </div>
  );
}
