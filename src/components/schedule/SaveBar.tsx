"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";

/**
 * Явно записване в края на екрана. Приложението пише и само (с малко закъснение),
 * за да не се губи работа при затваряне на раздела, но нарядчикът трябва да има
 * действие, което казва „готово“ — то изпразва отложения запис, преизчислява
 * итогите и показва какво точно е фиксирано.
 */
export default function SaveBar() {
  const { dirty, lastSaved, saveNow, schedule } = useApp();
  const [busy, setBusy] = useState(false);

  if (!schedule) return null;

  const run = async () => {
    setBusy(true);
    try { await saveNow(); } finally { setBusy(false); }
  };

  return (
    <div
      className="card no-print"
      style={{
        marginTop: 12, padding: 12, display: "flex", gap: 12,
        alignItems: "center", flexWrap: "wrap",
        borderColor: dirty ? "var(--accent)" : "var(--border)",
        borderWidth: dirty ? 2 : 1.5,
      }}
    >
      <button className="btn btn-primary" style={{ minWidth: 160, minHeight: 46 }} disabled={busy} onClick={run}>
        {busy ? "Записване…" : "Запази"}
      </button>

      <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: "var(--text-dim)" }}>
        {dirty ? (
          <span className="chip chip-warn">Има незаписани промени</span>
        ) : lastSaved ? (
          <span>
            <span className="chip chip-ok">Записано в {new Date(lastSaved.at).toLocaleTimeString("bg-BG")}</span>{" "}
            <span className="num">
              {lastSaved.employees} служители · {lastSaved.filledCells} попълнени клетки ·{" "}
              {lastSaved.errors} нарушения, {lastSaved.warnings} предупреждения
            </span>
          </span>
        ) : (
          <span className="chip chip-ok">Всичко е записано</span>
        )}
        <div style={{ marginTop: 6 }}>
          Записва се в браузъра на това устройство. За пренос използвайте „Експорт JSON“.
        </div>
      </div>
    </div>
  );
}
