"use client";

import Link from "next/link";
import { Modal, Field } from "@/components/ui";
import { useApp, useResolved } from "@/lib/store";
import { calcEmployee } from "@/lib/calc";
import { MONTHS_BG, formatHours } from "@/lib/time";
import { describePattern } from "@/lib/patterns";

/**
 * Служителят в контекста на текущия месец. Картонът му — Служ. №, име,
 * длъжност, полагаем ДО, дневна норма и базов шаблон — се води в справочника
 * („Настройки → Служители“) и тук само се показва. Оттук се пипа единствено
 * това, което се мени от месец на месец, и участието в този месец.
 */
export default function EmployeeEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const {
    settings, employees, roster,
    updateParticipant, removeParticipant, moveEmployee,
  } = useApp();
  const schedule = useResolved();
  const emp = employees.find((e) => e.id === id);
  const rosterEntry = roster.find((e) => e.id === id);
  if (!schedule || !emp || !rosterEntry) return null;
  const t = calcEmployee(schedule, emp, settings);

  const card: [string, string][] = [
    ["Служ. №", rosterEntry.serviceNo || "—"],
    ["Име, презиме, фамилия", rosterEntry.name || "—"],
    ["Длъжност", rosterEntry.position || "—"],
    ["Полагаем ДО (дни)", String(rosterEntry.annualLeaveDays)],
    ["Дневна норма (часове)", String(rosterEntry.dailyNorm)],
    ["Базов шаблон", describePattern(rosterEntry.pattern, settings)],
  ];

  return (
    <Modal open onClose={onClose} wide title={emp.name || "Служител"}>
      <div className="card" style={{ padding: 10, background: "var(--surface-2)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <div className="ui-label">Данни от справочника — важат за всички месеци</div>
          <Link href="/nastroyki" style={{ fontSize: 12, marginLeft: "auto" }}>
            Редактиране в Настройки → Служители
          </Link>
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginTop: 8 }}>
          {card.map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="ui-label" style={{ margin: "16px 0 6px" }}>
        Само за {schedule.header.month}/{schedule.header.year}
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label="Остатък +/− от минал месец" hint="Пренася се автоматично при откриване на месеца.">
          <input className="input num" inputMode="decimal" value={emp.carryOver}
            onChange={(e) => updateParticipant(emp.id, { carryOver: Number(e.target.value.replace(",", ".")) || 0 })} />
        </Field>
        <Field label="Фактически работни дни" hint="Смята се от попълнените кодове, не се въвежда.">
          <input className="input num" value={t.workDays} readOnly disabled />
        </Field>
      </div>

      {emp.carryOverReason && (
        <div
          className="card"
          style={{ marginTop: 10, padding: 10, borderColor: "var(--accent)", background: "var(--accent-soft)" }}
        >
          <strong style={{ fontSize: 13 }}>
            Доработка от {MONTHS_BG[Number(emp.carryOverReason.fromMonth.split("-")[1]) - 1]}{" "}
            {emp.carryOverReason.fromMonth.split("-")[0]}
          </strong>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Минусът от <span className="num">{formatHours(emp.carryOverReason.hours)}</span> ч. идва от ползван
            отпуск ({emp.carryOverReason.leaveDays} дни, <span className="num">{formatHours(emp.carryOverReason.leaveHours)}</span> ч.),
            а не от недоработка по друга причина. Покрива се с доработки — кодове 4–9.
          </div>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontWeight: 600, fontSize: 13 }}>
        <input type="checkbox" style={{ width: 20, height: 20 }} checked={emp.acknowledged}
          onChange={(e) => updateParticipant(emp.id, {
            acknowledged: e.target.checked,
            acknowledgedAt: e.target.checked ? new Date().toISOString() : undefined,
          })} />
        Запознат с графика срещу подпис
        {emp.acknowledgedAt && (
          <span className="num" style={{ color: "var(--text-dim)" }}>
            ({new Date(emp.acknowledgedAt).toLocaleDateString("bg-BG")})
          </span>
        )}
      </label>

      <div className="card" style={{ marginTop: 12, padding: 10, background: "var(--surface-2)" }}>
        <div className="ui-label" style={{ marginBottom: 6 }}>Итог за месеца</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, fontSize: 13 }}>
          {[
            ["Отработени", t.worked], ["Приравнен нощен", t.nightEqualized],
            ["Отпуск", t.leave], ["МО", t.sick],
            ["Общо", t.total], ["Норма", t.norm],
            ["(+/−) за месеца", t.diff], ["За следващ месец", t.carryForward],
          ].map(([label, v]) => (
            <div key={label as string}>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
              <div className={`num ${(v as number) < 0 ? "neg" : ""}`} style={{ fontSize: 15 }}>{formatHours(v as number)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => moveEmployee(emp.id, -1)}>↑ Нагоре</button>
        <button className="btn btn-sm" onClick={() => moveEmployee(emp.id, 1)}>↓ Надолу</button>
      </div>

      <div className="card" style={{ marginTop: 14, padding: 10, borderColor: "var(--border-strong)" }}>
        <div className="ui-label" style={{ marginBottom: 6 }}>Участие в месеца</div>
        <button
          className="btn btn-sm"
          title="Маха служителя само от този месец. Остава в справочника и може да бъде върнат по всяко време от „Състав за месеца“."
          onClick={() => {
            if (confirm(`Да се извади ли ${emp.name || "служителят"} от графика за ${schedule.header.month}/${schedule.header.year}?\n\nОстава в справочника и може да бъде върнат по всяко време.`)) {
              removeParticipant(emp.id);
              onClose();
            }
          }}
        >
          Извади от този месец
        </button>
        <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "8px 0 0" }}>
          Клетките му се запазват — при връщане разстановката се възстановява.
          Изтриването от справочника е в „Настройки → Служители“.
        </p>
      </div>
    </Modal>
  );
}
