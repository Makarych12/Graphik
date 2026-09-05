"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Modal } from "@/components/ui";
import { useApp } from "@/lib/store";
import { MONTHS_BG } from "@/lib/time";
import { describePattern } from "@/lib/patterns";

/**
 * Съставът за конкретния месец. Тук се решава само кой участва в този график —
 * личните данни идват от справочника в „Настройки“ и не се редактират оттук.
 * Изключеният остава в справочника заедно с попълнените си клетки: върне ли се,
 * разстановката му се възстановява.
 */
export default function MonthRoster({ onClose }: { onClose: () => void }) {
  const { roster, schedule, settings, addParticipant, removeParticipant } = useApp();

  const inMonth = useMemo(
    () => new Set(schedule?.participants.map((p) => p.employeeId) ?? []),
    [schedule],
  );

  if (!schedule) return null;
  const monthLabel = `${MONTHS_BG[schedule.header.month - 1]} ${schedule.header.year}`;

  return (
    <Modal open onClose={onClose} wide title={`Състав за ${monthLabel}`}>
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 0 }}>
        Отметката включва или изважда служителя само от този месец. Клетките му се
        запазват и при връщане разстановката се възстановява. Данните в картона —
        Служ. №, име, длъжност, полагаем ДО и базовият шаблон — се въвеждат в{" "}
        <Link href="/nastroyki">Настройки → Служители</Link>.
      </p>

      {roster.length === 0 && (
        <div className="card" style={{ padding: 14, color: "var(--text-dim)" }}>
          Справочникът е празен. Заведете състава на бригадата в{" "}
          <Link href="/nastroyki">Настройки → Служители</Link>.
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {roster.map((e) => {
          const on = inMonth.has(e.id);
          return (
            <label
              key={e.id}
              className="card"
              style={{
                display: "flex", gap: 10, alignItems: "center", padding: 8, cursor: "pointer",
                borderLeft: `6px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
              }}
            >
              <input
                type="checkbox"
                style={{ width: 20, height: 20, flex: "0 0 auto" }}
                checked={on}
                onChange={(ev) => (ev.target.checked ? addParticipant(e.id) : removeParticipant(e.id))}
              />
              <span className="num" style={{ minWidth: 46, color: "var(--text-dim)", fontSize: 12 }}>{e.serviceNo}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 13 }}>{e.name || "без име"}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
                  {e.position} · {describePattern(e.pattern, settings)}
                </span>
              </span>
              {!e.active && <span className="chip chip-warn" style={{ fontSize: 10 }}>извън състав</span>}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
