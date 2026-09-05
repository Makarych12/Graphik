"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { Field } from "@/components/ui";
import { DEFAULT_CODES, DEFAULT_SETTINGS } from "@/lib/defaults";
import type { ShiftCode, CodeCategory, Settings } from "@/lib/types";
import { breaksMinutes, spanMinutes } from "@/lib/time";
import * as db from "@/lib/db";
import Holidays from "@/components/settings/Holidays";
import RosterSection from "@/components/settings/RosterSection";

const CATEGORY_LABEL: Record<CodeCategory, string> = {
  work: "Работна смяна",
  leave: "Отпуск (ДО/НО/СО/УО)",
  sick: "Медицински отпуск (МО)",
  absent: "Неявка",
  trip: "Командировка",
  other: "Друго (по дневна норма)",
};

const THEME_LABEL: Record<Settings["theme"], string> = {
  light: "Светла",
  dark: "Тъмна",
  system: "Като системата",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>{title}</h2>
      {hint && <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "5px 0 12px", maxWidth: 720 }}>{hint}</p>}
      <div style={{ marginTop: hint ? 0 : 12 }}>{children}</div>
    </section>
  );
}

function CodeRow({ code, onChange, onDelete }: { code: ShiftCode; onChange: (c: ShiftCode) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const computed =
    code.start && code.end ? (spanMinutes(code.start, code.end) - breaksMinutes(code.breaks)) / 60 : null;

  return (
    <div className="card" style={{ padding: 8, borderLeft: `6px solid ${code.color}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input num" style={{ width: 66 }} placeholder="код" value={code.code}
          onChange={(e) => onChange({ ...code, code: e.target.value })}
        />
        <input
          className="input" style={{ flex: "1 1 180px", minWidth: 140 }} value={code.label}
          onChange={(e) => onChange({ ...code, label: e.target.value })}
        />
        {code.category === "work" && (
          <>
            <input className="input num" style={{ width: 96 }} type="time" value={code.start ?? ""} onChange={(e) => onChange({ ...code, start: e.target.value })} />
            <input className="input num" style={{ width: 96 }} type="time" value={code.end ?? ""} onChange={(e) => onChange({ ...code, end: e.target.value })} />
            <input className="input num" style={{ width: 72 }} inputMode="decimal" value={code.hours ?? ""} title="Отчетни часове"
              onChange={(e) => onChange({ ...code, hours: Number(e.target.value.replace(",", ".")) || 0 })} />
          </>
        )}
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? "▴" : "▾"}</button>
      </div>

      {!code.code.trim() && (
        <div style={{ fontSize: 11, color: "var(--error)", marginTop: 4 }}>
          Кодът е празен — няма да може да се въведе в мрежата.
        </div>
      )}
      {computed !== null && Math.abs(computed - (code.hours ?? 0)) > 0.01 && (
        <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 4 }}>
          По интервала и почивките излизат {computed.toFixed(2).replace(".", ",")} ч., а в легендата стоят {(code.hours ?? 0).toFixed(2).replace(".", ",")} ч.
        </div>
      )}

      {open && (
        <div style={{ marginTop: 8, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Field label="Категория">
            <select className="select" value={code.category} onChange={(e) => onChange({ ...code, category: e.target.value as CodeCategory })}>
              {(Object.keys(CATEGORY_LABEL) as CodeCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Цвят">
            <input className="input" type="color" style={{ padding: 2, height: 40 }} value={code.color} onChange={(e) => onChange({ ...code, color: e.target.value })} />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="ui-label" style={{ marginBottom: 4 }}>Прекъсвания вътре в смяната</div>
            {code.breaks.map((b, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                <input className="input num" style={{ width: 96 }} type="time" value={b.start}
                  onChange={(e) => onChange({ ...code, breaks: code.breaks.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })} />
                <input className="input num" style={{ width: 96 }} type="time" value={b.end}
                  onChange={(e) => onChange({ ...code, breaks: code.breaks.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })} />
                <select className="select" style={{ width: "auto", minWidth: 200 }} value={b.kind}
                  onChange={(e) => onChange({ ...code, breaks: code.breaks.map((x, j) => j === i ? { ...x, kind: e.target.value as "pochivka" | "prekasvane" } : x) })}>
                  <option value="pochivka">Почивка вътре в смяната</option>
                  <option value="prekasvane">Прекъсване на работния ден (чл.8)</option>
                </select>
                <button className="btn btn-sm btn-danger" onClick={() => onChange({ ...code, breaks: code.breaks.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => onChange({ ...code, breaks: [...code.breaks, { start: "12:00", end: "12:30", kind: "pochivka" }] })}>
              + Прекъсване
            </button>
            <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
              Проверката по чл.8 (най-много 2 на ден, всяко не по-малко от 1 час) се прилага
              само към редовете, отбелязани като „прекъсване на работния ден“.
            </p>
          </div>
          <div>
            <button className="btn btn-sm btn-danger" onClick={onDelete}>Изтрий кода</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Tab = "obshti" | "sluzhiteli";

const TAB_LABEL: Record<Tab, string> = {
  obshti: "Общи настройки",
  sluzhiteli: "Служители",
};

/**
 * Полетата, които се потвърждават с „Запази“ в края на раздела. Държат се в
 * чернова: докато не се натисне бутонът, темата не се сменя и коефициентите не
 * влизат в изчисленията на месеца.
 *
 * Празниците, длъжностите, легендата и архивът остават с незабавно действие —
 * те са списъци със собствени действия за добавяне и изтриване.
 */
type GeneralDraft = Pick<
  Settings,
  "theme" | "nightStart" | "nightEnd" | "nightFactor" | "weeklyMaxHours" | "holidayPayFactor"
>;

const pickGeneral = (s: Settings): GeneralDraft => ({
  theme: s.theme,
  nightStart: s.nightStart,
  nightEnd: s.nightEnd,
  nightFactor: s.nightFactor,
  weeklyMaxHours: s.weeklyMaxHours,
  holidayPayFactor: s.holidayPayFactor,
});

export default function SettingsPage() {
  const { settings, updateSettings, saveNow, lastSaved } = useApp();
  const [tab, setTab] = useState<Tab>("obshti");
  const [gen, setGen] = useState<GeneralDraft>(() => pickGeneral(settings));
  const [genTouched, setGenTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Ако настройките се сменят отвън (превключвателят на темата в лентата,
  // внесен архив), черновата ги следва — но само докато тук няма недовършена
  // редакция, за да не се изтрива въведеното.
  const stored = JSON.stringify(pickGeneral(settings));
  useEffect(() => {
    if (!genTouched) setGen(JSON.parse(stored) as GeneralDraft);
  }, [stored, genTouched]);

  const setDraft = (patch: Partial<GeneralDraft>) => {
    setGenTouched(true);
    setGen((g) => ({ ...g, ...patch }));
  };
  const genDirty = JSON.stringify(gen) !== stored;

  const saveGeneral = async () => {
    setSaving(true);
    try {
      updateSettings(gen);
      setGenTouched(false);
      await saveNow();
      flash("Общите настройки са записани.");
    } catch (e) {
      flash(`Грешка при записване: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const setCode = (c: ShiftCode) => updateSettings({ codes: settings.codes.map((x) => (x.id === c.id ? c : x)) });
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  return (
    <div style={{ maxWidth: 900, display: "grid", gap: 12 }}>
      <div className="tabs" role="tablist" style={{ justifySelf: "start" }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "sluzhiteli" && (
        <Section
          title="Служители"
          hint="Справочник на бригадата: личните данни се въвеждат тук веднъж и оттам влизат във всеки график."
        >
          <RosterSection />
        </Section>
      )}

      {tab === "obshti" && (
      <>
      <Section
        title="Интерфейс"
        hint="Езикът на приложението е български по задание — термините идват дословно от бланка на депото и от Наредба № 50, затова не се превеждат."
      >
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Field label="Тема">
            <select className="select" value={gen.theme} onChange={(e) => setDraft({ theme: e.target.value as Settings["theme"] })}>
              {(Object.keys(THEME_LABEL) as Settings["theme"][]).map((t) => (
                <option key={t} value={t}>{THEME_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Език на интерфейса">
            <input className="input" value="Български" readOnly disabled />
          </Field>
        </div>
      </Section>

      <Section title="Изчисляване" hint="Стойностите влизат директно във формулите за месеца (D.5) и в правната проверка.">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <Field label="Начало на нощния труд">
            <input className="input num" type="time" value={gen.nightStart} onChange={(e) => setDraft({ nightStart: e.target.value })} />
          </Field>
          <Field label="Край на нощния труд">
            <input className="input num" type="time" value={gen.nightEnd} onChange={(e) => setDraft({ nightEnd: e.target.value })} />
          </Field>
          <Field label="Коефициент за приравняване" hint="8 : 7 ≈ 1,1429 — нощната норма е 7 ч. срещу 8 ч. дневна.">
            <input className="input num" inputMode="decimal" value={gen.nightFactor.toFixed(4)}
              onChange={(e) => setDraft({ nightFactor: Number(e.target.value.replace(",", ".")) || 8 / 7 })} />
          </Field>
          <Field label="Максимум часове на седмица">
            <input className="input num" inputMode="decimal" value={gen.weeklyMaxHours}
              onChange={(e) => setDraft({ weeklyMaxHours: Number(e.target.value.replace(",", ".")) || 56 })} />
          </Field>
          <Field label="Коефициент за труд в празник" hint="чл.264 КТ — не по-малко от удвоения размер.">
            <input className="input num" inputMode="decimal" value={gen.holidayPayFactor}
              onChange={(e) => setDraft({ holidayPayFactor: Number(e.target.value.replace(",", ".")) || 2 })} />
          </Field>
        </div>
        <button
          className="btn btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => setDraft({
            nightStart: DEFAULT_SETTINGS.nightStart,
            nightEnd: DEFAULT_SETTINGS.nightEnd,
            nightFactor: DEFAULT_SETTINGS.nightFactor,
            weeklyMaxHours: DEFAULT_SETTINGS.weeklyMaxHours,
            holidayPayFactor: DEFAULT_SETTINGS.holidayPayFactor,
          })}
        >
          Върни стойностите по наредбата
        </button>
      </Section>

      <Section
        title="Официални празници"
        hint="Производственият календар по чл.154 от Кодекса на труда. Влиза в НОРМА /часове/ на месеца и в отчитането на труда в празник."
      >
        <Holidays />
      </Section>

      <Section title="Длъжности" hint="По една на ред. Ползват се като подсказки при въвеждане на служител в справочника.">
        <textarea
          className="input"
          style={{ minHeight: 96, fontFamily: "var(--mono)" }}
          value={settings.positions.join("\n")}
          onChange={(e) => updateSettings({ positions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
        />
      </Section>

      <Section
        title="Легенда на кодовете"
        hint="Базовият набор е снет от реален бланк на депото. Кодовете, часовете, цветовете и прекъсванията се редактират свободно за конкретната бригада."
      >
        <div style={{ display: "grid", gap: 6 }}>
          {settings.codes.map((c) => (
            <CodeRow key={c.id} code={c} onChange={setCode}
              onDelete={() => updateSettings({ codes: settings.codes.filter((x) => x.id !== c.id) })} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => updateSettings({
              codes: [...settings.codes, {
                id: `c${Date.now().toString(36)}`, code: "", label: "Нов код",
                category: "work", start: "08:00", end: "16:00", hours: 8, breaks: [], color: "#546E7A",
              }],
            })}
          >
            + Код
          </button>
          <button className="btn" onClick={() => { if (confirm("Възстановяване на базовата легенда от реалния бланк? Ръчните промени по кодовете ще се загубят.")) updateSettings({ codes: DEFAULT_CODES }); }}>
            Възстанови базовата легенда
          </button>
        </div>
      </Section>

      <Section title="Данни" hint="Всичко се пази в браузъра на това устройство. Пренасянето между устройства става с файл.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={async () => {
              const data = await db.exportAll();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `grafik-arhiv-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              flash("Архивът е свален.");
            }}
          >
            Експорт на всички данни
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Импорт от файл</button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const mode = confirm("OK — заместване на всички данни.\nОтказ — сливане с наличните.") ? "replace" : "merge";
                const r = await db.importAll(JSON.parse(await f.text()), mode as "replace" | "merge");
                flash(`Внесени ${r.schedules} месеца и ${r.employees} служители. Презареждане…`);
                setTimeout(() => location.reload(), 900);
              } catch (err) {
                flash(`Грешка при внасяне: ${(err as Error).message}`);
              }
            }}
          />
        </div>
        {msg && <div className="chip chip-accent" style={{ marginTop: 8 }}>{msg}</div>}
      </Section>

      {/* Потвърждаване на общите настройки. Докато не се натисне, темата,
          моделът и коефициентите стоят само в тази форма. */}
      <div
        className="card"
        style={{
          padding: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          borderColor: genDirty ? "var(--accent)" : "var(--border)",
          borderWidth: genDirty ? 2 : 1.5,
        }}
      >
        <button
          className="btn btn-primary"
          style={{ minWidth: 160, minHeight: 46 }}
          disabled={saving || !genDirty}
          onClick={() => void saveGeneral()}
        >
          {saving ? "Записване…" : "Запази"}
        </button>
        <div style={{ flex: 1, minWidth: 240, fontSize: 12, color: "var(--text-dim)" }}>
          {genDirty ? (
            <span className="chip chip-warn">Има незаписани промени</span>
          ) : lastSaved ? (
            <span className="chip chip-ok">Записано в {new Date(lastSaved.at).toLocaleTimeString("bg-BG")}</span>
          ) : (
            <span className="chip chip-ok">Всичко е записано</span>
          )}
          <div style={{ marginTop: 6 }}>
            Записва темата и коефициентите за изчисляване (нощен труд, приравняване,
            максимум часове на седмица, труд в празник). Празниците, длъжностите,
            легендата и архивът се прилагат веднага.
          </div>
        </div>
        {genDirty && (
          <button className="btn" disabled={saving} onClick={() => { setGenTouched(false); setGen(pickGeneral(settings)); }}>
            Отказ
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}
