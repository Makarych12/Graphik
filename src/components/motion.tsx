"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Общи движения на интерфейса.
 *
 * Инструментът е работен, не витрина: преходите са 0,12–0,26 s и служат само
 * да покажат откъде идва съдържанието. Мрежата на графика умишлено остава
 * извън тях — при въвеждане на код реакцията трябва да е мигновена.
 *
 * При включено „намалено движение“ в системата всичко се свежда до просто
 * показване, а в печата инлайн стиловете на Motion се неутрализират от
 * правило в globals.css.
 */

/** Кратък, лек изход от долу нагоре — за карти и раздели. */
export function Reveal({
  children,
  delay = 0,
  y = 8,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const still = useReducedMotion();
  return (
    <motion.div
      data-motion
      className={className}
      style={style}
      initial={still ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Разгъване по височина — за картона на служителя и подобни. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          data-motion
          key="collapse"
          initial={still ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Смяна на съдържание на място: старото излиза, новото влиза. Ползва се за
 * разделите и за смяната на месеца, където посоката носи смисъл.
 */
export function Swap({
  id,
  direction = 0,
  distance = 18,
  children,
}: {
  id: string;
  /** −1 назад, 1 напред, 0 без посока (само избледняване). */
  direction?: number;
  distance?: number;
  children: ReactNode;
}) {
  const still = useReducedMotion();
  const dx = direction * distance;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        data-motion
        key={id}
        initial={still ? false : { opacity: 0, x: dx, y: direction === 0 ? 6 : 0 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={still ? undefined : { opacity: 0, x: -dx, y: direction === 0 ? -4 : 0 }}
        transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Ред от списък, който се появява и изчезва — нарушения, бележки. */
export function ListItem({ children }: { children: ReactNode }) {
  const still = useReducedMotion();
  return (
    <motion.div
      data-motion
      layout={still ? false : "position"}
      initial={still ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={still ? undefined : { opacity: 0, y: -6 }}
      transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export { AnimatePresence, motion, useReducedMotion };
