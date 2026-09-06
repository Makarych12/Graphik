"use client";

import { useMemo, useState } from "react";
import { useApp, useResolved, type Patch } from "@/lib/store";
import { validateSchedule } from "@/lib/validation";
import type { ResolvedSchedule } from "@/lib/types";

/**
 * Задължителният предпросмотър преди прилагане (D.7.1).
 *
 * Нищо, което асистентът предлага, не се записва само: тук нарядчикът вижда
 * четимо „беше → ще стане“ за всяка засегната клетка и за всяко действие извън
 * клетките, и потвърждава с едно натискане. Необратимите действия минават през
 * отделно, засилено потвърждение. Веднага след записа се показва какво е
 * открила правната проверка.
 */
export default function PatchPreview() {
  const { pendingPatch, settings, applyPendingPatch, discardPendingPatch, lastApply, clearLastApply } = useApp();
  const schedule = useResolved();
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const groups = useMemo(() => groupCells(pendingPatch, schedule, settings.codes), [pendingPatch, schedule, settings.codes]);

  if (!schedule) return null;

  // ── След прилагане: резултатът от автоматичната правна проверка ──────────
  if (!pendingPatch) {
    if (!lastApply) return null;
    const bad = lastApply.fresh.filter((v) => v.severity === "error");
    const warn = lastApply.fresh.filter((v) => v.severity === "warning");
    return (
      <div
        className="card no-print"
        style={{ borderColor: bad.length ? "var(--error)" : "var(--ok, var(--border))", borderWidth: 2, marginTop: 10, overflow: "hidden" }}
      >
        <div style={{ background: bad.length ? "var(--error-soft)" : "var(--surface-2)", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>Промяната е приложена</strong>
          <span className={`chip ${lastApply.after > lastApply.before ? "chip-error" : lastApply.after < lastApply.before ? "chip-ok" : ""}`}>
            нарушения: {lastApply.before} → {lastApply.after}
          </span>
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={clearLastApply}>Скрий</button>
        </div>
        <div style={{ padding: "8px 12px", fontSize: 13 }}>{lastApply.summary}</div>
        {bad.length === 0 && warn.length === 0 ? (
          <div style={{ padding: "0 12px 10px", fontSize: 12, color: "var(--text-dim)" }}>
            Правната проверка по Наредба № 50 не откри нови нарушения.
          </div>
        ) : (
          <div style={{ padding: "0 12px 10px", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: bad.length ? "var(--error)" : "var(--warn)" }}>
              ⚠ Промяната поражда {bad.length ? `${bad.length} нови нарушения` : `${warn.length} нови предупреждения`}. Промяната НЕ е отменена — решението е ваше.
            </div>
            {[...bad, ...warn].slice(0, 12).map((v) => (
              <div key={v.id} style={{ fontSize: 12, lineHeight: 1.45 }}>
                <span className="chip" style={{ marginRight: 6 }}>{v.article}</span>
                {v.message}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const danger = pendingPatch.danger;
  const ops = pendingPatch.ops ?? [];
  const canApply = !danger || understood;

  const apply = async () => {
    setBusy(true);
    try {
      await applyPendingPatch();
    } finally {
      setBusy(false);
      setUnderstood(false);
    }
  };

  return (
    <div
      className="card no-print"
      style={{ borderColor: danger ? "var(--error)" : "var(--accent)", borderWidth: 2, marginTop: 10, overflow: "hidden" }}
    >
      <div style={{ background: danger ? "var(--error-soft)" : "var(--accent-soft)", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>
          {danger ? "Необратимо действие — чака потвърждение" : "Предложение от ИИ — чака потвърждение"}
        </strong>
        {pendingPatch.cells.length > 0 && <span className="chip chip-accent num">{pendingPatch.cells.length} клетки</span>}
        {ops.length > 0 && <span className="chip chip-accent num">{ops.length} действия</span>}
        {sim && pendingPatch.cells.length > 0 && (
          <span className={`chip ${sim.after < sim.before ? "chip-ok" : sim.after > sim.before ? "chip-error" : ""}`}>
            нарушения: {sim.before} → {sim.after}
          </span>
        )}
      </div>

      <div style={{ padding: "8px 12px", fontSize: 13 }}>{pendingPatch.summary}</div>

      {ops.length > 0 && (
        <div style={{ padding: "0 12px 8px", display: "grid", gap: 8 }}>
          {ops.map((op, i) => (
            <div key={i} style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{op.label}</div>
              {op.details?.map((d, j) => (
                <div key={j} style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{d}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {pendingPatch.header && (
        <div style={{ padding: "0 12px 8px", display: "grid", gap: 3 }}>
          {Object.entries(pendingPatch.header).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12 }}>
              <span className="ui-label">{HEADER_LABELS[k] ?? k}:</span>{" "}
              <span className="num" style={{ color: "var(--text-dim)" }}>
                {String((schedule.header as unknown as Record<string, unknown>)[k] ?? "—")}
              </span>{" "}
              →{" "}
              <span className="num" style={{ fontWeight: 800 }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div className="scroll-y" style={{ maxHeight: 260, borderTop: "1px solid var(--border)" }}>
          <table className="sched-grid" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingLeft: 8 }}>Служител</th>
                <th style={{ width: 88 }}>Дни</th>
                <th style={{ width: 64 }}>Било</th>
                <th style={{ width: 64 }}>Става</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.rows.map((r, i) => (
                  <tr key={`${g.employeeId}-${r.days}-${i}`}>
                    <td style={{ padding: "0 8px", fontSize: 12, whiteSpace: "nowrap" }}>{i === 0 ? g.name : ""}</td>
                    <td className="num" style={{ textAlign: "center", fontSize: 12 }}>{r.days}</td>
                    <td className="num" style={{ textAlign: "center", color: "var(--text-dim)" }}>{r.from}</td>
                    <td className="num" style={{ textAlign: "center", fontWeight: 800, color: "var(--accent-text)" }}>{r.to}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {danger && (
        <div style={{ padding: 12, background: "var(--error-soft)", borderTop: "1.5px solid var(--error)", display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 13, color: "var(--error)" }}>⚠ {danger.title}</strong>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>{danger.text}</div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ marginTop: 2 }} />
            Разбирам, че действието е необратимо за всички бъдещи месеци.
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1.5px solid var(--border)" }}>
        <button
          className={danger ? "btn btn-danger" : "btn btn-primary"}
          style={{ flex: 1 }}
          disabled={!canApply || busy}
          onClick={() => void apply()}
        >
          {danger ? danger.confirmLabel : "Приложи промените"}
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={discardPendingPatch}>Откажи</button>
      </div>
    </div>
  );
}

const HEADER_LABELS: Record<string, string> = {
  organization: "Организация",
  department: "Поделение",
  brigade: "Бригада",
  normHours: "Норма (часове)",
};

type Group = { employeeId: string; name: string; rows: { days: string; from: string; to: string }[] };

/**
 * Групира промените по служител и слива последователните дни с еднаква
 * промяна в интервал („3–7“). Без това предложение за цял месец се изсипва
 * като стотици еднакви реда и става нечетимо.
 */
function groupCells(
  patch: Patch | null,
  schedule: ResolvedSchedule | null,
  codes: { id: string; code: string }[],
): Group[] {
  if (!patch || !schedule) return [];
  const codeOf = (id?: string) => codes.find((c) => c.id === id)?.code ?? "—";
  const out: Group[] = [];

  for (const e of schedule.employees) {
    const mine = patch.cells.filter((c) => c.employeeId === e.id).sort((a, b) => a.day - b.day);
    if (!mine.length) continue;

    const rows: Group["rows"] = [];
    let run: { first: number; last: number; from: string; to: string } | null = null;
    const flush = () => {
      if (!run) return;
      rows.push({ days: run.first === run.last ? String(run.first) : `${run.first}–${run.last}`, from: run.from, to: run.to });
      run = null;
    };
    for (const c of mine) {
      const from = codeOf(c.from?.codeId);
      const to = codeOf(c.to?.codeId);
      if (run && run.last === c.day - 1 && run.from === from && run.to === to) run.last = c.day;
      else {
        flush();
        run = { first: c.day, last: c.day, from, to };
      }
    }
    flush();
    out.push({ employeeId: e.id, name: e.name || "—", rows });
  }

  // Промени за хора извън състава на месеца (напр. върнат служител).
  const known = new Set(schedule.employees.map((e) => e.id));
  const rest = patch.cells.filter((c) => !known.has(c.employeeId));
  if (rest.length) {
    out.push({
      employeeId: "—",
      name: "(извън състава)",
      rows: rest.map((c) => ({ days: String(c.day), from: codeOf(c.from?.codeId), to: codeOf(c.to?.codeId) })),
    });
  }
  return out;
}
