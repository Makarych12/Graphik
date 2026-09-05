"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useResolved } from "@/lib/store";
import { calcAll, calcBrigade, calcCell } from "@/lib/calc";
import { validateSchedule, violationsByCell, worstSeverity } from "@/lib/validation";
import { MONTHS_BG, daysInMonth, formatHours, isNonWorking, weekdayLetter } from "@/lib/time";
import { holidayName, isHoliday } from "@/lib/holidays";
import { contrastInk } from "@/lib/color";
import CodePicker from "./CodePicker";

export type Sel = { employeeId: string; day: number } | null;

/** "2026-09" → "септември 2026" */
function monthLabel(id: string): string {
  const [y, m] = id.split("-").map(Number);
  return `${MONTHS_BG[m - 1]} ${y}`;
}

export default function ScheduleGrid({
  onEditEmployee,
}: {
  onEditEmployee: (id: string) => void;
}) {
  const { settings, setCell, toggleAcknowledged } = useApp();
  const schedule = useResolved();
  const [sel, setSel] = useState<Sel>(null);
  const [picker, setPicker] = useState(false);
  const bufferRef = useRef({ text: "", at: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => (schedule ? calcAll(schedule, settings) : {}), [schedule, settings]);
  const brigade = useMemo(() => calcBrigade(totals), [totals]);
  const violations = useMemo(() => (schedule ? validateSchedule(schedule, settings) : []), [schedule, settings]);
  const byCell = useMemo(() => violationsByCell(violations), [violations]);

  const dim = schedule ? daysInMonth(schedule.header.year, schedule.header.month) : 30;
  const days = useMemo(() => Array.from({ length: dim }, (_, i) => i + 1), [dim]);

  const applyTyped = useCallback(
    (text: string) => {
      if (!sel) return false;
      // Кодове без обозначение не участват — иначе празният низ съвпада с всичко.
      const named = settings.codes.filter((c) => c.code.trim());
      const matches = named.filter((c) => c.code.toLowerCase().startsWith(text.toLowerCase()));
      const exact = named.find((c) => c.code.toLowerCase() === text.toLowerCase());
      if (exact && matches.length === 1) {
        setCell(sel.employeeId, sel.day, { codeId: exact.id });
        return true;
      }
      if (matches.length === 1) {
        setCell(sel.employeeId, sel.day, { codeId: matches[0].id });
        return true;
      }
      if (exact) {
        setCell(sel.employeeId, sel.day, { codeId: exact.id });
        return false; // може да е префикс на по-дълъг код — буферът остава
      }
      return matches.length === 0;
    },
    [sel, settings.codes, setCell],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!schedule || !sel) return;
      const idx = schedule.employees.findIndex((x) => x.id === sel.employeeId);
      const move = (dr: number, dc: number) => {
        e.preventDefault();
        const r = Math.min(Math.max(idx + dr, 0), schedule.employees.length - 1);
        const d = Math.min(Math.max(sel.day + dc, 1), dim);
        setSel({ employeeId: schedule.employees[r].id, day: d });
      };
      switch (e.key) {
        case "ArrowUp": return move(-1, 0);
        case "ArrowDown": return move(1, 0);
        case "ArrowLeft": return move(0, -1);
        case "ArrowRight": return move(0, 1);
        case "Enter": e.preventDefault(); return setPicker(true);
        case "Delete":
        case "Backspace":
          e.preventDefault();
          return setCell(sel.employeeId, sel.day, null);
        case "Escape": return setSel(null);
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        const b = bufferRef.current;
        b.text = now - b.at < 900 ? b.text + e.key : e.key;
        b.at = now;
        const done = applyTyped(b.text);
        if (done) b.text = "";
      }
    },
    [schedule, sel, dim, setCell, applyTyped],
  );

  useEffect(() => {
    if (sel) wrapRef.current?.focus();
  }, [sel]);

  if (!schedule) return null;

  const headSpan = 2;

  return (
    <>
      <div
        className="grid-wrap"
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ outline: "none" }}
      >
        <table className="sched-grid">
          <thead>
            <tr>
              <th rowSpan={headSpan} className="sticky-l c-ack no-print" title="Запознат с графика срещу подпис">Зап.</th>
              <th rowSpan={headSpan} className="sticky-l c-serv col-compact-hide">Служ.<br />№</th>
              <th rowSpan={headSpan} className="sticky-l c-name" style={{ textAlign: "left", paddingLeft: 8 }}>
                Име, презиме, фамилия
              </th>
              <th rowSpan={headSpan} className="c-pos col-compact-hide">Длъжност</th>
              <th rowSpan={headSpan} className="c-do col-compact-hide">Полагаем ДО</th>
              <th rowSpan={headSpan} className="c-wd col-compact-hide" title="Фактически работни дни на служителя за месеца — смята се автоматично">Работни дни</th>
              <th rowSpan={headSpan} className="c-rest col-compact-hide col-sep">Остатък +/− от минал месец</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={[
                    "day-cell",
                    isNonWorking(schedule.header.year, schedule.header.month, d) ? "weekend" : "",
                    isHoliday(schedule.header.year, schedule.header.month, d) ? "holiday" : "",
                  ].join(" ")}
                  title={holidayName(schedule.header.year, schedule.header.month, d) ?? undefined}
                >
                  <span className="num">{d}</span>
                </th>
              ))}
              <th rowSpan={headSpan} className="totals-cell col-sep">Отработени часове</th>
              <th rowSpan={headSpan} className="totals-cell">Приравнен нощен труд</th>
              <th rowSpan={headSpan} className="totals-cell" title="Отработени часове, паднали се в официален празник — заплащат се удвоено (чл.264 КТ)">Труд в празник (×2)</th>
              <th rowSpan={headSpan} className="totals-cell">Ползван отпуск ДО/НО/СО/УО</th>
              <th rowSpan={headSpan} className="totals-cell">Ползван МО</th>
              <th rowSpan={headSpan} className="totals-cell st-r r-total">Общо часове за месеца</th>
              <th rowSpan={headSpan} className="totals-cell st-r r-diff">(+/−) за месеца</th>
              <th rowSpan={headSpan} className="totals-cell st-r r-carry">(+/−) за следващ месец</th>
            </tr>
            <tr>
              {days.map((d) => (
                <th
                  key={d}
                  className={[
                    "day-cell",
                    isNonWorking(schedule.header.year, schedule.header.month, d) ? "weekend" : "",
                    isHoliday(schedule.header.year, schedule.header.month, d) ? "holiday" : "",
                  ].join(" ")}
                  style={{ fontWeight: 700, color: isNonWorking(schedule.header.year, schedule.header.month, d) ? "var(--error)" : "var(--text-dim)" }}
                  title={holidayName(schedule.header.year, schedule.header.month, d) ?? undefined}
                >
                  {holidayName(schedule.header.year, schedule.header.month, d)
                    ? "\u2605"
                    : weekdayLetter(schedule.header.year, schedule.header.month, d)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {schedule.employees.map((emp) => {
              const t = totals[emp.id];
              return (
                <tr key={emp.id} className="emp-row">
                  <td className="sticky-l c-ack no-print" style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={emp.acknowledged}
                      onChange={() => toggleAcknowledged(emp.id)}
                      title={emp.acknowledged && emp.acknowledgedAt ? `Запознат на ${new Date(emp.acknowledgedAt).toLocaleDateString("bg-BG")}` : "Отбележи като запознат срещу подпис"}
                      style={{ width: 16, height: 16 }}
                    />
                  </td>
                  <td className="sticky-l c-serv col-compact-hide num" style={{ textAlign: "center" }}>{emp.serviceNo}</td>
                  <td className="sticky-l c-name" style={{ padding: "0 6px" }}>
                    <button
                      className="btn btn-sm"
                      style={{
                        border: "none", background: "transparent", width: "100%",
                        justifyContent: "flex-start", padding: 0, minHeight: "var(--row-h)",
                        fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", display: "block",
                        textAlign: "left", whiteSpace: "nowrap",
                      }}
                      onClick={() => onEditEmployee(emp.id)}
                      title="Редактиране на служителя"
                    >
                      {emp.name || <span style={{ color: "var(--text-faint)" }}>без име</span>}
                    </button>
                  </td>
                  <td className="c-pos col-compact-hide" style={{ padding: "0 6px", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.position}</td>
                  <td className="c-do col-compact-hide num" style={{ textAlign: "center" }}>{emp.annualLeaveDays}</td>
                  <td className="c-wd col-compact-hide num" style={{ textAlign: "center" }} title="Фактически работни дни за месеца">{t.workDays}</td>
                  <td className={`c-rest col-compact-hide col-sep num totals-cell ${emp.carryOver < 0 ? "neg" : emp.carryOver > 0 ? "pos" : ""}`}>
                    {emp.carryOverReason && (
                      <span
                        className="badge-do"
                        title={`Доработка от ${monthLabel(emp.carryOverReason.fromMonth)}: минусът от ${formatHours(emp.carryOverReason.hours)} ч. идва от ползван отпуск (${emp.carryOverReason.leaveDays} дни). Покрива се с доработки — кодове 4–9.`}
                      >
                        ДР
                      </span>
                    )}
                    {formatHours(emp.carryOver)}
                  </td>

                  {days.map((d) => {
                    const cell = schedule.cells[emp.id]?.[d];
                    const c = calcCell(cell, d, emp, settings, schedule.header);
                    const v = byCell.get(`${emp.id}:${d}`);
                    const sev = worstSeverity(v);
                    const weekend = isNonWorking(schedule.header.year, schedule.header.month, d);
                    const holiday = isHoliday(schedule.header.year, schedule.header.month, d);
                    const selected = sel?.employeeId === emp.id && sel.day === d;
                    const code = c.code;
                    const solid = code && code.category !== "work" && code.category !== "other";
                    // Официалният празник се чете по заливката на цялата колона и по
                    // звездата в шапката. По-рано всяка клетка носеше и черта отгоре —
                    // на хартия тя излизаше като чертичка, залепена за самия код.
                    const codeBar = code && !solid ? `inset 3px 0 0 ${code.color}` : "";
                    const shadow = codeBar;
                    const style: React.CSSProperties = {
                      ...(code
                        ? solid
                          ? { background: code.color, color: contrastInk(code.color) }
                          : { background: `color-mix(in srgb, ${code.color} 26%, var(--surface))` }
                        : {}),
                      ...(shadow ? { boxShadow: shadow } : {}),
                    };
                    return (
                      <td
                        key={d}
                        className={[
                          "day-cell",
                          weekend ? "weekend" : "",
                          holiday ? "holiday" : "",
                          selected ? "sel" : "",
                          sev === "error" ? "has-error" : sev === "warning" ? "has-warn" : "",
                        ].join(" ")}
                        style={style}
                        title={
                          [code ? `${code.code} — ${code.label}` : "",
                           c.workHours ? `${formatHours(c.workHours)} ч.` : "",
                           holiday ? `Официален празник: ${holidayName(schedule.header.year, schedule.header.month, d)}` : "",
                           c.holidayHours > 0 ? `Труд в празник — заплаща се удвоено (чл.264 КТ)` : "",
                           ...(v ?? []).map((x) => `${x.article}: ${x.message}`)]
                            .filter(Boolean).join("\n") || undefined
                        }
                        onClick={() => {
                          setSel({ employeeId: emp.id, day: d });
                          if (selected) setPicker(true);
                        }}
                        onDoubleClick={() => { setSel({ employeeId: emp.id, day: d }); setPicker(true); }}
                      >
                        <span className="code">{code?.code ?? ""}</span>
                      </td>
                    );
                  })}

                  <td className="totals-cell col-sep num">{formatHours(t.worked)}</td>
                  <td className="totals-cell num">{formatHours(t.nightEqualized)}</td>
                  <td className="totals-cell num" style={t.holidayHours > 0 ? { color: "var(--accent-text)", fontWeight: 800 } : undefined}
                      title={t.holidayDays ? `${t.holidayDays} дни труд в празник` : undefined}>
                    {formatHours(t.holidayHours)}
                  </td>
                  <td className="totals-cell num">{formatHours(t.leave)}</td>
                  <td className="totals-cell num">{formatHours(t.sick)}</td>
                  <td className="totals-cell num st-r r-total" style={{ fontWeight: 800 }}>{formatHours(t.total)}</td>
                  <td className={`totals-cell num st-r r-diff ${t.diff < 0 ? "neg" : t.diff > 0 ? "pos" : ""}`}>{formatHours(t.diff)}</td>
                  <td className={`totals-cell num st-r r-carry ${t.carryForward < 0 ? "neg" : t.carryForward > 0 ? "pos" : ""}`} style={{ fontWeight: 800 }}>
                    {formatHours(t.carryForward)}
                  </td>
                </tr>
              );
            })}

            <tr style={{ fontWeight: 800 }}>
              <td className="sticky-l c-ack no-print" style={{ background: "var(--surface-3)" }} />
              <td className="sticky-l c-serv col-compact-hide" style={{ background: "var(--surface-3)" }} />
              <td className="sticky-l c-name" style={{ background: "var(--surface-3)", padding: "0 6px" }}>ОБЩО за бригадата</td>
              <td className="c-pos col-compact-hide" style={{ background: "var(--surface-3)" }} />
              <td className="c-do col-compact-hide" style={{ background: "var(--surface-3)" }} />
              <td className="c-wd col-compact-hide num" style={{ background: "var(--surface-3)", textAlign: "center" }}>{brigade.workDays}</td>
              <td className="c-rest col-compact-hide col-sep num totals-cell" style={{ background: "var(--surface-3)" }}>
                {formatHours(schedule.employees.reduce((a, e) => a + e.carryOver, 0))}
              </td>
              {days.map((d) => <td key={d} className="day-cell" style={{ background: "var(--surface-3)" }} />)}
              <td className="totals-cell col-sep num" style={{ background: "var(--surface-3)" }}>{formatHours(brigade.worked)}</td>
              <td className="totals-cell num" style={{ background: "var(--surface-3)" }}>{formatHours(brigade.nightEqualized)}</td>
              <td className="totals-cell num" style={{ background: "var(--surface-3)" }}>{formatHours(brigade.holidayHours)}</td>
              <td className="totals-cell num" style={{ background: "var(--surface-3)" }}>{formatHours(brigade.leave)}</td>
              <td className="totals-cell num" style={{ background: "var(--surface-3)" }}>{formatHours(brigade.sick)}</td>
              <td className="totals-cell num st-r r-total" style={{ background: "var(--surface-3)" }}>{formatHours(brigade.total)}</td>
              <td className={`totals-cell num st-r r-diff ${brigade.diff < 0 ? "neg" : "pos"}`} style={{ background: "var(--surface-3)" }}>{formatHours(brigade.diff)}</td>
              <td className={`totals-cell num st-r r-carry ${brigade.carryForward < 0 ? "neg" : "pos"}`} style={{ background: "var(--surface-3)" }}>{formatHours(brigade.carryForward)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodePicker
        open={picker}
        onClose={() => setPicker(false)}
        employeeId={sel?.employeeId ?? null}
        day={sel?.day ?? null}
      />
    </>
  );
}
