"use client";

import { useApp } from "@/lib/store";
import { formatHours } from "@/lib/time";
import type { ShiftCode } from "@/lib/types";

/** Кодът се чете като етикет — в цвета, с който се пълни клетката в мрежата. */
function Code({ code }: { code: ShiftCode }) {
  return (
    <span className="legend-code" style={{ "--code-color": code.color } as React.CSSProperties}>
      {code.code}
    </span>
  );
}

/** Колонките са по съдържание — иначе между името и часовете зее празно поле. */
function ShiftTable({ codes }: { codes: ShiftCode[] }) {
  return (
    <table className="legend-table">
      <thead>
        <tr>
          <th className="lc-code">Код</th>
          <th>Наименование</th>
          <th className="lc-time">Време</th>
          <th className="lc-hours" title="Отчетни часове на смяната">Часа</th>
        </tr>
      </thead>
      <tbody>
        {codes.map((c) => (
          <tr key={c.id}>
            <td className="lc-code"><Code code={c} /></td>
            <td className="lc-name">{c.label}</td>
            <td className="lc-time num legend-time">
              {c.start && c.end ? `${c.start}–${c.end}` : "—"}
            </td>
            <td className="lc-hours num legend-hours">
              {c.hours ? formatHours(c.hours, 0) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Отсъствията нямат време и часове — само код и разшифровка. */
function AbsenceTable({ codes }: { codes: ShiftCode[] }) {
  if (!codes.length) return null;
  return (
    <table className="legend-table">
      <thead>
        <tr>
          <th className="lc-code">Код</th>
          <th>Наименование</th>
        </tr>
      </thead>
      <tbody>
        {codes.map((c) => (
          <tr key={c.id}>
            <td className="lc-code"><Code code={c} /></td>
            <td className="lc-name">{c.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Легенда на кодовете — на екрана и в печатния бланк (C.3).
 *
 * Смените са разделени на две колони, за да не расте височината, а колонките
 * са по съдържание, не разтеглени по ширината на листа. Бележката за
 * празниците е отделена като акцент, защото от нея зависи заплащането
 * (чл.264 КТ), а не е пояснение под черта.
 */
export default function Legend() {
  const codes = useApp((s) => s.settings.codes);
  const shifts = codes.filter((c) => c.category === "work" || c.category === "other");
  const absences = codes.filter((c) => c.category !== "work" && c.category !== "other");
  const half = Math.ceil(shifts.length / 2);
  const absHalf = Math.ceil(absences.length / 2);

  return (
    <section className="card legend">
      <div className="ui-label legend-title">Легенда на кодовете</div>

      <div className="legend-groups">
        <div className="legend-card">
          <div className="legend-card-title">Кодове на смените</div>
          <div className="legend-split">
            <ShiftTable codes={shifts.slice(0, half)} />
            <ShiftTable codes={shifts.slice(half)} />
          </div>
        </div>

        <div className="legend-card">
          <div className="legend-card-title">Отсъствия и командировка</div>
          <div className="legend-split">
            <AbsenceTable codes={absences.slice(0, absHalf)} />
            <AbsenceTable codes={absences.slice(absHalf)} />
          </div>
        </div>
      </div>

      <div className="legend-holiday">
        <span className="legend-holiday-star">★</span>
        <span>
          <strong>Официален празник</strong> (чл.154 КТ) — залята колона в мрежата.
          Труд в такъв ден се заплаща не по-малко от удвоения размер (чл.264 КТ)
          и се отчита в колона „Труд в празник“.
        </span>
      </div>
    </section>
  );
}
