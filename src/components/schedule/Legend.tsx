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

/**
 * Легенда на кодовете — на екрана и в печатния бланк (C.3).
 *
 * Двете групи са отделни блокове със свое заглавие, а вътре всяка е таблица:
 * код / наименование / време / часове стоят в общи колони, за да се четат
 * отгоре надолу. Бележката за празниците е отделена като акцент, защото от нея
 * зависи заплащането (чл.264 КТ), а не е пояснение под черта.
 */
export default function Legend() {
  const codes = useApp((s) => s.settings.codes);
  const shifts = codes.filter((c) => c.category === "work" || c.category === "other");
  const absences = codes.filter((c) => c.category !== "work" && c.category !== "other");

  return (
    <section className="card legend">
      <div className="ui-label legend-title">Легенда на кодовете</div>

      <div className="legend-groups">
        <div className="legend-card">
          <div className="legend-card-title">Кодове на смените</div>
          <table className="legend-table">
            <thead>
              <tr>
                <th className="lc-code">Код</th>
                <th>Наименование</th>
                <th className="lc-time">Време</th>
                <th className="lc-hours">Часове</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((c) => (
                <tr key={c.id}>
                  <td className="lc-code"><Code code={c} /></td>
                  <td>{c.label}</td>
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
        </div>

        <div className="legend-card">
          <div className="legend-card-title">Отсъствия и командировка</div>
          <table className="legend-table">
            <thead>
              <tr>
                <th className="lc-code">Код</th>
                <th>Наименование</th>
              </tr>
            </thead>
            <tbody>
              {absences.map((c) => (
                <tr key={c.id}>
                  <td className="lc-code"><Code code={c} /></td>
                  <td>{c.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
