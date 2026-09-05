import type { HolidayEntry } from "./holidays";

// Домейн модел на приложението за графици на работното време (БДЖ).
// Терминологията е дословна от Наредба № 50 и от реалния бланк (части B и C).

/** Как кодът участва в изчисленията за месеца (D.5). */
export type CodeCategory =
  | "work" // отработени часове
  | "leave" // ползван отпуск ДО/НО/СО/УО — в часове по норма
  | "sick" // ползван МО (медицински отпуск, болничен)
  | "absent" // неявка/самоотлъчка — 0 часа
  | "trip" // командировка — по дневна норма
  | "other"; // медицински преглед и др. — по дневна норма, без нощен труд

/** Прекъсване вътре в смяната. */
export type Break = {
  start: string; // "12:00"
  end: string; // "12:30"
  /**
   * "pochivka" — почивка/хранене вътре в смяната (не влиза в отработеното време,
   * но не е прекъсване на работния ден по смисъла на чл.8).
   * "prekasvane" — разкъсване на работния ден по чл.8: не повече от 2 на ден,
   * всяко не по-малко от 1 час.
   */
  kind: "pochivka" | "prekasvane";
};

export type ShiftCode = {
  id: string;
  /** Кодът, както се пише в клетката: "1", "3", "ДО", "Б"… */
  code: string;
  /** Наименование от легендата на бланка. */
  label: string;
  category: CodeCategory;
  /** "07:30" — само за категория work. */
  start?: string;
  /** "19:15"; ако е по-малко от start — смяната преминава през полунощ. */
  end?: string;
  /** Отчетни часове по легендата (без прекъсванията). */
  hours?: number;
  breaks: Break[];
  /** Цвят за цветовото кодиране в мрежата. */
  color: string;
  /** Системните кодове не могат да бъдат изтрити, но могат да се редактират. */
  builtin?: boolean;
};

export type Person = {
  name: string;
  position: string;
};

/** Шапка на документа — изцяло редактируема (D.8.1). */
export type ScheduleHeader = {
  organization: string;
  department: string;
  brigade: string;
  month: number; // 1..12
  year: number;
  /**
   * НОРМА /часове/ за месеца при пълно работно време. Пресмята се автоматично
   * от производствения календар при откриване на месеца и остава редактируема,
   * защото е реквизит на документа.
   *
   * РАБОТНИ ДНИ съзнателно ги няма тук: те не са общ показател за бланката —
   * всеки служител има свои фактически работни дни (отпуск, болничен, различен
   * режим), затова се смятат и се показват поотделно на всеки ред.
   */
  normHours: number;
  preparedBy: Person; // Изготвил
  agreedBy: Person; // Съгласувал
  approvedBy: Person; // Утвърдил
};

/**
 * Запис в справочника на бригадата — постоянните данни за човека, които не
 * зависят от месеца. Живее отделно от графиците и се ползва от всички месеци.
 */
export type RosterEmployee = {
  id: string;
  serviceNo: string; // Служ. №
  name: string; // Име, презиме, фамилия
  position: string; // Длъжност
  annualLeaveDays: number; // Полагаем ДО (дни)
  dailyNorm: number; // дневна норма в часове (8, при намалено работно време — по-малко)
  /** Извън състава (напуснал, преместен) — не се включва автоматично в нови месеци. */
  active: boolean;
  /** Базов шаблон за автоматичната разстановка на смените. */
  pattern?: ShiftPattern;
  note?: string;
};

/**
 * Базов шаблон на смените за служителя (D.2.1). Ползва се за ЧЕРНОВА
 * автоматична разстановка при откриване на нов месец — нарядчикът може да
 * презапише всеки ден върху нея.
 */
export type ShiftPattern =
  | { kind: "none" }
  /**
   * Цикъл 2 през 2: два работни дни, два дни у дома, само дневни смени
   * (кодове 1 и 2 — I и II смяна, по 11 ч.). Цикълът е непрекъснат и се брои
   * от опорната дата, затова не се нулира на 1-во число на месеца.
   * При два кода блоковете се редуват: 2 дни по първия, 2 почивни, 2 дни по
   * втория, 2 почивни.
   */
  | { kind: "cycle2x2"; anchor: string; codeIds: string[] }
  /** Фиксирана редовна смяна понеделник–петък (код 3, 8 ч.). */
  | { kind: "weekdays"; codeId: string };

export type Roster = {
  employees: RosterEmployee[];
  updatedAt: string;
};

/**
 * Участие на служител в конкретен месец. Тук са само нещата, които се менят
 * от месец на месец; името, длъжността и полагаемият отпуск идват от справочника.
 */
/**
 * Защо служителят влиза в месеца с отрицателен остатък. Пренасянето вече работи
 * (D.5 т.5); това е само пояснение за нарядчика — минусът от ползван отпуск се
 * закрива с доработки (кодове 4–9), а не е обикновена недоработка.
 */
export type CarryOverReason = {
  kind: "leave";
  /** "2026-09" — месецът, от който идва минусът. */
  fromMonth: string;
  leaveDays: number;
  leaveHours: number;
  /** Размерът на минуса в часове (положително число). */
  hours: number;
};

export type ScheduleParticipant = {
  employeeId: string;
  carryOver: number; // Остатък +/- от минал месец (часове)
  carryOverReason?: CarryOverReason;
  acknowledged: boolean; // запознат с графика срещу подпис (D.4.2)
  acknowledgedAt?: string; // ISO дата
};

/**
 * Обединен изглед: запис от справочника + участието му в текущия месец.
 * Това е формата, с която работят мрежата и изчисленията.
 */
export type Employee = Omit<RosterEmployee, "active" | "note"> & Omit<ScheduleParticipant, "employeeId">;

export type Cell = {
  codeId: string;
  /** Ръчно зададени часове, ако се разминават с легендата. */
  overrideHours?: number;
  /** Удължаване по чл.14 — оформено с телефонограма/писмена заповед. */
  extension?: { approved: boolean; order?: string };
  note?: string;
};

export type ScheduleStatus = "draft" | "review" | "approved";

export type Schedule = {
  /** "2026-09" */
  id: string;
  header: ScheduleHeader;
  /** Кой от справочника участва в този месец и с какъв пренесен остатък. */
  participants: ScheduleParticipant[];
  /**
   * Изрично извадени от този месец (напр. цял месец в отпуск). Нужен е, за да
   * може съставът да се подтегля автоматично от справочника, без да връща
   * обратно хората, които нарядчикът съзнателно е махнал.
   */
  excluded?: string[];
  /** cells[employeeId][ден 1..31] */
  cells: Record<string, Record<number, Cell>>;
  status: ScheduleStatus;
  updatedAt: string;
};

/** График с разрешени служители — това получават изчисленията и правният двигател. */
export type ResolvedSchedule = Omit<Schedule, "participants"> & { employees: Employee[] };

// ─── Модул "Рейси" (повески) ────────────────────────────────────────────────

export type TripMode =
  | "named" // именен график — предварително разписана явка/отправяне
  | "callless" // безизвикателна система — по ред на опашката след почивката
  | "oncall"; // по извикване — еднократно назначение извън графика

export type Trip = {
  id: string;
  employeeId: string;
  mode: TripMode;
  international: boolean; // интероперативен граничен превоз (чл.16а, 17а, 17б)
  /** ISO datetime — явка (началото на повеската). */
  yavka: string;
  /** Пристигане в оборотния пункт. */
  arrivalTurnaround?: string;
  /** Отправяне от оборотния пункт обратно. */
  departureTurnaround?: string;
  /** Освобождаване в основния пункт (краят на повеската). */
  release: string;
  /** Има ли стая за отдих в оборотния пункт (чл.17). */
  restRoom: boolean;
  /** Удължаване по чл.14. */
  extension?: { approved: boolean; order?: string };
  /** Втори машинист в локомотива — отпада почивката по чл.17б. */
  secondDriver?: boolean;
  /** Почивка вътре в повеската, в минути (чл.17б — 45 мин. при >8 ч., 30 мин. при 6–8 ч.). */
  breakMinutes?: number;
  /** Време на управление (часове), за контрола по чл.17б при международни рейсове. */
  drivingOut?: number;
  drivingBack?: number;
  route?: string;
  note?: string;
};

export type TripBoard = {
  /** "2026-09" */
  id: string;
  trips: Trip[];
  updatedAt: string;
};

// ─── Валидация ──────────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

export type Violation = {
  id: string;
  severity: Severity;
  /** "чл.16" — за препратката към Наредбата. */
  article: string;
  message: string;
  employeeId?: string;
  /** Ден от месеца, ако нарушението е локализирано в клетка. */
  day?: number;
  tripId?: string;
};

// ─── Настройки ──────────────────────────────────────────────────────────────

export type Settings = {
  codes: ShiftCode[];
  positions: string[];
  /** "system" следва настройката на устройството. */
  theme: "light" | "dark" | "system";
  /** Коефициент за приравняване на нощния труд (C.5): 8/7. */
  nightFactor: number;
  nightStart: string; // "22:00"
  nightEnd: string; // "06:00"
  /** Максимална седмична продължителност (D.6). */
  weeklyMaxHours: number;
  /**
   * Ръчни поправки на производствения календар по години ("2026": [...]).
   * Вграденият списък по чл.154 КТ се смята автоматично; тук се записват само
   * отклоненията — премествания със заповед на МС, добавени неработни дни или
   * празник, обявен за работен.
   */
  holidays: Record<string, HolidayEntry[]>;
  /** Коефициент за труд в официален празник (чл.264 КТ — не по-малко от удвоен). */
  holidayPayFactor: number;
};
