"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type Option = { value: string; label: string };

/**
 * Падащ списък със собствено разгъване.
 *
 * Родният `<select>` отваря списък на операционната система — той не може да
 * се анимира и изглежда чуждо до останалите контроли. Тук списъкът е част от
 * страницата, затова се появява плавно и носи стила на приложението.
 *
 * Клавиатурата работи като при роден списък: ↑/↓ движат, Enter избира,
 * Escape затваря, Home/End отиват в двата края.
 */
export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = "—",
  disabled,
  style,
  title,
  ariaLabel,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
}) {
  const still = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const index = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const current = index >= 0 ? options[index] : null;

  useEffect(() => {
    if (open) setActive(index >= 0 ? index : 0);
  }, [open, index]);

  // Затваряне при щракване извън контрола или при превъртане на страницата.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Избраният ред трябва да се вижда веднага след разгъването.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape": e.preventDefault(); return setOpen(false);
      case "Enter": case " ": e.preventDefault(); return pick(active);
      case "ArrowDown": e.preventDefault(); return setActive((i) => Math.min(i + 1, options.length - 1));
      case "ArrowUp": e.preventDefault(); return setActive((i) => Math.max(i - 1, 0));
      case "Home": e.preventDefault(); return setActive(0);
      case "End": e.preventDefault(); return setActive(options.length - 1);
      case "Tab": return setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="dd" style={style}>
      <button
        type="button"
        className={open ? "select dd-button is-open" : "select dd-button"}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="dd-value">{current ? current.label : placeholder}</span>
        <motion.span
          className="dd-caret"
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
            <path d="M1.25 1.75 6 6.25l4.75-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            data-motion
            id={listId}
            ref={listRef}
            className="dd-list card scroll-y"
            role="listbox"
            tabIndex={-1}
            initial={still ? false : { opacity: 0, y: -6, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={still ? undefined : { opacity: 0, y: -6, scaleY: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
            style={{ transformOrigin: "top" }}
          >
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={
                  "dd-option" +
                  (o.value === value ? " is-current" : "") +
                  (i === active ? " is-active" : "")
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                {o.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
