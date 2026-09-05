"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/store";
import { Swap, motion, AnimatePresence } from "@/components/motion";
import type { Settings } from "@/lib/types";
import { MONTHS_BG } from "@/lib/time";
import * as db from "@/lib/db";

const NAV = [
  { href: "/", label: "Смени" },
  { href: "/reisove", label: "Рейси" },
  { href: "/nastroyki", label: "Настройки" },
];

export function OnlineBadge() {
  const online = useApp((s) => s.online);
  return (
    <span className={`chip ${online ? "chip-ok" : "chip-warn"}`} title={online ? "Има връзка с мрежата" : "Няма връзка — таблицата, изчисленията и правната проверка работят и офлайн"}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor" }} />
      {online ? "Онлайн" : "Офлайн"}
    </span>
  );
}

/**
 * Темата се пази на едно място — в настройките на приложението. Записът в
 * localStorage е само огледало, за да няма премигване преди зареждането на
 * базата (виж скрипта в layout.tsx).
 */
export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  root.dataset.theme =
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
  try { localStorage.setItem("grafik-theme", theme); } catch { /* частен режим */ }
}

const THEME_ORDER: Settings["theme"][] = ["light", "dark", "system"];
const THEME_ICON: Record<Settings["theme"], string> = { light: "☀", dark: "☾", system: "◐" };
const THEME_LABEL: Record<Settings["theme"], string> = {
  light: "Светла тема", dark: "Тъмна тема", system: "Като системата",
};

function ThemeToggle() {
  const theme = useApp((s) => s.settings.theme);
  const updateSettings = useApp((s) => s.updateSettings);
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  return (
    <button
      className="btn btn-sm"
      onClick={() => updateSettings({ theme: next })}
      title={`${THEME_LABEL[theme]} — превключване към „${THEME_LABEL[next].toLowerCase()}“`}
    >
      {THEME_ICON[theme]}
    </button>
  );
}

function MonthPicker() {
  const { schedule, openMonth } = useApp();
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<string[]>([]);

  useEffect(() => {
    if (open) void db.listSchedules().then((l) => setMonths(l.map((s) => s.id)));
  }, [open, schedule?.id]);

  if (!schedule) return null;
  const { year, month } = schedule.header;

  const step = (d: number) => {
    const m = month + d;
    if (m < 1) void openMonth(year - 1, 12);
    else if (m > 12) void openMonth(year + 1, 1);
    else void openMonth(year, m);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
      <button className="btn btn-sm btn-icon" onClick={() => step(-1)} title="Предходен месец">‹</button>
      <button className="btn btn-sm num" onClick={() => setOpen(!open)} style={{ minWidth: 150 }}>
        {MONTHS_BG[month - 1]} {year}
      </button>
      <button className="btn btn-sm btn-icon" onClick={() => step(1)} title="Следващ месец">›</button>
      <AnimatePresence>
      {open && (
        <motion.div
          data-motion
          className="card"
          initial={{ opacity: 0, y: -6, scaleY: 0.96 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          exit={{ opacity: 0, y: -6, scaleY: 0.96 }}
          transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
          style={{ position: "absolute", top: "110%", right: 0, zIndex: 40, minWidth: 200, maxHeight: 320, overflowY: "auto", padding: 6, transformOrigin: "top", boxShadow: "var(--shadow-pop)" }}
        >
          <div className="ui-label" style={{ padding: "4px 6px" }}>Запазени месеци</div>
          {months.length === 0 && <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 13 }}>Няма запазени.</div>}
          {months.map((id) => {
            const [y, m] = id.split("-").map(Number);
            return (
              <button
                key={id}
                className="btn btn-sm"
                style={{ width: "100%", justifyContent: "flex-start", border: "none", background: id === schedule.id ? "var(--accent-soft)" : "transparent" }}
                onClick={() => { void openMonth(y, m); setOpen(false); }}
              >
                {MONTHS_BG[m - 1]} {y}
              </button>
            );
          })}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, init } = useApp();

  useEffect(() => { void init(); }, [init]);

  // Прилага темата от настройките след зареждането им от базата.
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    if (theme !== "system") return;
    // При „като системата“ смяната в устройството трябва да се хване веднага.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [ready, theme]);

  // Регистрация на service worker — само в продукция, за да работи офлайн.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const set = () => useApp.setState({ online: navigator.onLine });
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header className="no-print app-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginRight: "auto" }}>
          <div
            aria-hidden
            style={{ width: 4, height: 28, background: "var(--accent)", borderRadius: 99 }}
          />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>График</div>
            <div className="ui-label" style={{ fontSize: 9.5 }}>Работно време</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={active ? "nav-link is-active" : "nav-link"}
                aria-current={active ? "page" : undefined}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <MonthPicker />
        <OnlineBadge />
        <ThemeToggle />
      </header>

      <main style={{ flex: 1, padding: "16px 14px 28px" }}>
        {ready ? (
          <Swap id={pathname}>{children}</Swap>
        ) : (
          <div style={{ padding: 24, color: "var(--text-dim)" }}>Зареждане…</div>
        )}
      </main>
    </div>
  );
}
