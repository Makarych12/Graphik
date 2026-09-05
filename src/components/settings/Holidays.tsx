"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { listHolidays, type HolidayEntry } from "@/lib/holidays";
import { MONTHS_BG, countWorkingDays } from "@/lib/time";

/**
 * Редактор на производствения календар. Вграденият списък по чл.154 КТ се смята
 * автоматично за всяка година (включително православния Великден и
 * преместванията, когато празник се падне в събота или неделя). Тук се записват
 * само отклоненията — например преместване със заповед на Министерския съвет.
 */
export default function Holidays() {
  const { settings, updateSettings, schedule } = useApp();
  const [year, setYear] = useState(schedule?.header.year ?? new Date().getFullYear());
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");

  // Списъкът зависи от поправките в настройките.
  const rows = useMemo(() => listHolidays(year), [year, settings.holidays]);
  const monthsLine = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${MONTHS_BG[i]} ${countWorkingDays(year, i + 1)}`).join(" · "),
    [year, settings.holidays],
  );

  const yearKey = String(year);
  const overrides: HolidayEntry[] = settings.holidays[yearKey] ?? [];

  const setOverrides = (next: HolidayEntry[]) =>
    updateSettings({ holidays: { ...settings.holidays, [yearKey]: next } });

  const upsert = (entry: HolidayEntry) =>
    setOverrides([...overrides.filter((o) => o.date !== entry.date), entry]);

  const clearOverride = (date: string) =>
    setOverrides(overrides.filter((o) => o.date !== date));

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn btn-sm btn-icon" onClick={() => setYear(year - 1)}>‹</button>
        <span className="num" style={{ fontSize: 18, fontWeight: 800, minWidth: 60, textAlign: "center" }}>{year}</span>
        <button className="btn btn-sm btn-icon" onClick={() => setYear(year + 1)}>›</button>
        {overrides.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => {
              const rest = { ...settings.holidays };
              delete rest[yearKey];
              updateSettings({ holidays: rest });
            }}
          >
            Върни по подразбиране ({overrides.length} поправки)
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((r) => {
          const d = new Date(r.date);
          const overridden = overrides.some((o) => o.date === r.date);
          return (
            <div
              key={r.date}
              className="card"
              style={{
                display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", flexWrap: "wrap",
                opacity: r.removed ? 0.5 : 1,
                borderLeft: `5px solid ${r.removed ? "var(--border-strong)" : "var(--accent)"}`,
              }}
            >
              <span className="num" style={{ minWidth: 92, fontSize: 12 }}>
                {String(d.getDate()).padStart(2, "0")}.{String(d.getMonth() + 1).padStart(2, "0")}.{d.getFullYear()}
              </span>
              <input
                className="input" style={{ flex: "1 1 200px", minWidth: 150, minHeight: 32 }}
                value={r.name}
                onChange={(e) => upsert({ date: r.date, name: e.target.value })}
              />
              {!r.builtin && <span className="chip chip-accent" style={{ fontSize: 10 }}>добавен</span>}
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600 }}>
                <input
                  type="checkbox" style={{ width: 18, height: 18 }} checked={!r.removed}
                  onChange={(e) => {
                    if (e.target.checked) upsert({ date: r.date, name: r.name });
                    else if (r.builtin) upsert({ date: r.date, name: r.name, removed: true });
                    else clearOverride(r.date);
                  }}
                />
                неработен
              </label>
              {overridden && (
                <button className="btn btn-sm" title="Връща вградената стойност за този ден" onClick={() => clearOverride(r.date)}>↺</button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="ui-label">Добави неработен ден</span>
          <input className="input num" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </label>
        <input className="input" style={{ flex: "1 1 200px" }} placeholder="Наименование" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button
          className="btn"
          disabled={!newDate || !newName.trim()}
          onClick={() => {
            const y = String(new Date(newDate).getFullYear());
            const list = settings.holidays[y] ?? [];
            updateSettings({
              holidays: {
                ...settings.holidays,
                [y]: [...list.filter((o) => o.date !== newDate), { date: newDate, name: newName.trim() }],
              },
            });
            setYear(Number(y));
            setNewDate(""); setNewName("");
          }}
        >
          Добави
        </button>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10, marginBottom: 4 }}>
        Работни дни по месеци за {year}: <span className="num">{monthsLine}</span>
      </p>
      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>
        Промените веднага влизат в производствения календар. За вече откритите месеци
        нормата се пресмята наново с бутона „Пресметни по календар“ в шапката на графика.
        Трудът в официален празник се отчита отделно в колоната „Труд в празник (×2)“ —
        заплаща се не по-малко от удвоения размер (чл.264 КТ).
      </p>
    </>
  );
}
