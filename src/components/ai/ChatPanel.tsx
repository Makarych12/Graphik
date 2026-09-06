"use client";

import { useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { TOOL_DEFS, contextSummary, runTool } from "@/lib/ai/tools";
import { systemPrompt } from "@/lib/ai/naredba";
import PatchPreview from "./PatchPreview";

type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

const SUGGESTIONS = [
  "Провери целия график и изброй нарушенията с членове.",
  "Обясни защо балансът на този служител е отрицателен.",
  "Предложи разпределение на доработките, за да се покрие нормата.",
  "Намери и поправи грешките в графика за месеца.",
];

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const online = useApp((s) => s.online);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toolLog, setToolLog] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError("");
    setInput("");
    // Ново съобщение = нов ход: извикванията от този ход се събират в едно
    // предложение, а непотвърденото отпреди си остава недокоснато.
    useApp.getState().beginTurn();
    const userMsg: Msg = { role: "user", content: text };
    let convo: Msg[] = [...history, userMsg];
    setHistory(convo);
    setBusy(true);
    setToolLog([]);

    try {
      const base: Msg[] = [
        { role: "system", content: systemPrompt() },
        { role: "system", content: `Моментна снимка на състоянието:\n${contextSummary()}` },
      ];

      for (let step = 0; step < 8; step++) {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...base, ...convo], tools: TOOL_DEFS }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const msg = data.choices?.[0]?.message as Msg | undefined;
        if (!msg) throw new Error("Празен отговор от модела.");

        convo = [...convo, msg];
        setHistory(convo);

        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* моделът е върнал невалиден JSON */ }
            setToolLog((l) => [...l, tc.function.name]);
            const content = await runTool(tc.function.name, args);
            convo = [...convo, { role: "tool", tool_call_id: tc.id, name: tc.function.name, content }];
          }
          setHistory(convo);
          continue;
        }
        break;
      }
    } catch (e) {
      // Прекъсната връзка по време на разговора — мрежовата грешка на fetch идва
      // като TypeError и не носи разбираемо съобщение.
      const msg = e instanceof TypeError
        ? "Няма връзка с интернет. ИИ-асистентът работи само онлайн — таблицата, изчисленията и правната проверка продължават да работят."
        : (e as Error).message;
      setError(msg);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);
    }
  };

  const visible = history.filter((m) => (m.role === "user" || m.role === "assistant") && m.content);

  return (
    <aside className="card no-print ai-panel">
      <div className="hairline ai-fixed" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
        <strong style={{ fontSize: 14 }}>ИИ-асистент</strong>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button>
      </div>

      {!online && (
        <div className="ai-fixed" style={{ padding: 12, background: "var(--warn-soft)", color: "var(--warn)", fontSize: 13, fontWeight: 700 }}>
          Няма връзка с интернет. ИИ-асистентът работи само онлайн — таблицата,
          изчисленията и правната проверка продължават да работят офлайн.
        </div>
      )}

      <div ref={scrollRef} className="ai-scroll" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
            <p style={{ marginTop: 0 }}>
              Асистентът вижда текущия график и може сам да предлага промени в него.
              Всяко предложение минава през предпросмотър и се прилага само след потвърждение.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn btn-sm" style={{ justifyContent: "flex-start", textAlign: "left", height: "auto", padding: "8px 10px", whiteSpace: "normal" }}
                  onClick={() => void send(s)} disabled={!online}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {visible.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "94%",
              background: m.role === "user" ? "var(--accent-soft)" : "var(--surface-2)",
              border: "1.5px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              lineHeight: 1.45,
            }}
          >
            {m.content}
          </div>
        ))}

        {busy && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Работи…{toolLog.length > 0 && ` (${toolLog.join(" → ")})`}
          </div>
        )}
        {error && <div className="chip chip-error" style={{ whiteSpace: "normal", height: "auto", padding: 8 }}>{error}</div>}
      </div>

      {/* Предложението стои извън плъзгащия се разговор: то има собствена
          височина и собствен скрол, а бутоните му остават винаги видими. */}
      <PatchPreview />

      <form
        className="hairline ai-fixed"
        style={{ display: "flex", gap: 6, padding: 10, borderTop: "1.5px solid var(--border)" }}
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <input
          className="input"
          placeholder={online ? "Въпрос или задача…" : "Няма връзка"}
          value={input}
          disabled={!online || busy}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!online || busy || !input.trim()}>→</button>
      </form>
    </aside>
  );
}
