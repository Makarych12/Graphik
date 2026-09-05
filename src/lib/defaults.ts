import type { ShiftCode, Settings, ScheduleHeader, RosterEmployee } from "./types";

/** Двете фиксирани почивки за смени >= 8 часа (част C.3) — настройваеми. */
const STD_BREAKS = [
  { start: "12:00", end: "12:30", kind: "pochivka" as const },
  { start: "14:00", end: "14:15", kind: "pochivka" as const },
];

/**
 * Легенда на кодовете — дословно от реалния бланк (част C.3).
 * Служи като базов набор; справочникът е редактируем от нарядчика.
 */
export const DEFAULT_CODES: ShiftCode[] = [
  { id: "c1", code: "1", label: "Дневно дежурство, I смяна", category: "work", start: "07:30", end: "19:15", hours: 11, breaks: STD_BREAKS, color: "#2E7D32", builtin: true },
  { id: "c2", code: "2", label: "Дневно дежурство, II смяна", category: "work", start: "09:30", end: "21:15", hours: 11, breaks: STD_BREAKS, color: "#1565C0", builtin: true },
  { id: "c3", code: "3", label: "Редовна смяна", category: "work", start: "07:30", end: "16:15", hours: 8, breaks: STD_BREAKS, color: "#37474F", builtin: true },
  { id: "c4", code: "4", label: "Доработка", category: "work", start: "07:30", end: "12:30", hours: 5, breaks: [], color: "#6A1B9A", builtin: true },
  { id: "c5", code: "5", label: "Доработка", category: "work", start: "07:30", end: "13:30", hours: 6, breaks: [], color: "#6A1B9A", builtin: true },
  { id: "c6", code: "6", label: "Доработка", category: "work", start: "07:30", end: "17:15", hours: 9, breaks: STD_BREAKS, color: "#6A1B9A", builtin: true },
  { id: "c7", code: "7", label: "Доработка", category: "work", start: "07:30", end: "18:15", hours: 10, breaks: STD_BREAKS, color: "#6A1B9A", builtin: true },
  { id: "c8", code: "8", label: "Доработка", category: "work", start: "08:00", end: "12:00", hours: 4, breaks: [], color: "#6A1B9A", builtin: true },
  { id: "c9", code: "9", label: "Доработка", category: "work", start: "07:30", end: "19:30", hours: 12, breaks: STD_BREAKS, color: "#AD1457", builtin: true },
  { id: "c10", code: "10", label: "Медицински преглед", category: "other", breaks: [], color: "#00838F", builtin: true },

  { id: "cdo", code: "ДО", label: "Домашен отпуск", category: "leave", breaks: [], color: "#EF6C00", builtin: true },
  { id: "cno", code: "НО", label: "Неплатен отпуск", category: "leave", breaks: [], color: "#8D6E63", builtin: true },
  { id: "cso", code: "СО", label: "Служебен / синдикален отпуск", category: "leave", breaks: [], color: "#5D4037", builtin: true },
  { id: "cuo", code: "УО", label: "Ученически отпуск", category: "leave", breaks: [], color: "#00695C", builtin: true },
  { id: "cb", code: "Б", label: "Медицински отпуск (болничен)", category: "sick", breaks: [], color: "#C62828", builtin: true },
  { id: "cya", code: "Я", label: "Неявка / самоотлъчка", category: "absent", breaks: [], color: "#B71C1C", builtin: true },
  { id: "ck", code: "К", label: "Командировка", category: "trip", breaks: [], color: "#4527A0", builtin: true },
];

/** Пример от реалния документ (част C.1) — всяко поле е редактируемо. */
export const DEFAULT_HEADER: ScheduleHeader = {
  organization: '"БДЖ – Пътнически превози" ЕООД',
  department: "ППП Горна Оряховица, Локомотивно депо, Район Варна",
  brigade: "Ремонтна / дежурна бригада",
  month: 9,
  year: 2026,
  normHours: 160,
  preparedBy: { name: "", position: "Нарядчик" },
  agreedBy: { name: "", position: "Ръководител Район" },
  approvedBy: { name: "", position: "Началник депо" },
};

export const DEFAULT_POSITIONS = [
  "РПТДКПС",
  "ел.техник",
  "заварчик",
  "дефектоскопист",
  "шлосер",
  "машинист локомотив",
  "помощник-машинист",
  "влаков придружител",
];

export const DEFAULT_SETTINGS: Settings = {
  codes: DEFAULT_CODES,
  positions: DEFAULT_POSITIONS,
  theme: "system",
  nightFactor: 8 / 7,
  nightStart: "22:00",
  nightEnd: "06:00",
  weeklyMaxHours: 56,
  holidays: {},
  holidayPayFactor: 2,
};

export function emptyRosterEmployee(index = 0): RosterEmployee {
  return {
    id: `e${Date.now().toString(36)}${index}`,
    serviceNo: "",
    name: "",
    position: DEFAULT_POSITIONS[0],
    annualLeaveDays: 20,
    dailyNorm: 8,
    active: true,
  };
}
