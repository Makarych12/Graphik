"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="ui-label">{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{hint}</span> : null}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
    {open && (
    <motion.div
      data-motion
      className="no-print"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "color-mix(in srgb, var(--bg) 55%, rgba(0,0,0,.6))",
        backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        ref={ref}
        className="card"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        style={{
          width: "100%", maxWidth: wide ? 900 : 560, maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          borderRadius: "var(--r-lg) var(--r-lg) 0 0", borderBottom: "none",
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <div className="hairline" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", gap: 8 }}>
          <strong style={{ fontSize: 15, letterSpacing: "-0.015em" }}>{title}</strong>
          <button className="btn btn-sm" onClick={onClose} aria-label="Затваряне">✕</button>
        </div>
        <div className="scroll-y" style={{ padding: 16 }}>{children}</div>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}

export function SeverityDot({ severity }: { severity: "error" | "warning" | "info" }) {
  const color = severity === "error" ? "var(--error)" : severity === "warning" ? "var(--warn)" : "var(--text-faint)";
  return <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: "0 0 auto", marginTop: 5 }} />;
}
