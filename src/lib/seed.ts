import type { RosterEmployee, Schedule, ScheduleParticipant, Settings } from "./types";
import { DEFAULT_HEADER } from "./defaults";
import { countWorkingDays, scheduleId } from "./time";
import { patternMonth } from "./patterns";

/**
 * Примерна бригада и график при първо стартиране — по образеца от реалния
 * бланк (част C). Данните са демонстрационни: съставът се редактира в
 * справочника, разстановката — в графика. Целта е при първо отваряне да се
 * вижда работеща таблица с итоги и жива правна проверка, а не празен екран.
 *
 * Разстановката минава през същия двигател на шаблони (D.2.1), който работи и
 * при откриване на нов месец — така демото показва реалното поведение,
 * включително че официалните празници не прекъсват цикъла.
 */
const SAMPLE = [
  { serviceNo: "1042", name: "Иван Петров Иванов", position: "РПТДКПС", pattern: "duty1", carryOver: -352 },
  { serviceNo: "1087", name: "Георги Стоянов Николов", position: "РПТДКПС", pattern: "duty2", carryOver: -512 },
  { serviceNo: "1133", name: "Димитър Ангелов Тодоров", position: "ел.техник", pattern: "regular", carryOver: 0 },
  { serviceNo: "1156", name: "Стефан Христов Маринов", position: "заварчик", pattern: "regular", carryOver: -8 },
  { serviceNo: "1198", name: "Николай Динев Костов", position: "дефектоскопист", pattern: "regular", carryOver: 16 },
  { serviceNo: "1214", name: "Петър Илиев Славов", position: "шлосер", pattern: "leave", carryOver: -24 },
] as const;

export function seedRoster(settings: Settings): RosterEmployee[] {
  const byCode = (c: string) => settings.codes.find((x) => x.code === c)?.id ?? "";
  const { year, month } = DEFAULT_HEADER;
  const iso = (d: number) => `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return SAMPLE.map((s, i) => ({
    id: `seed${i + 1}`,
    serviceNo: s.serviceNo,
    name: s.name,
    position: s.position,
    annualLeaveDays: 20 + (i % 3),
    dailyNorm: 8,
    active: true,
    pattern:
      s.pattern === "duty1"
        ? { kind: "cycle2x2" as const, anchor: iso(1), codeIds: [byCode("1")] }
        : s.pattern === "duty2"
          ? { kind: "cycle2x2" as const, anchor: iso(3), codeIds: [byCode("2")] }
          : { kind: "weekdays" as const, codeId: byCode("3") },
  }));
}

export function seedSchedule(settings: Settings, roster: RosterEmployee[]): Schedule {
  const { year, month } = DEFAULT_HEADER;
  const wd = countWorkingDays(year, month);
  const DO = settings.codes.find((x) => x.code === "ДО")?.id;

  const participants: ScheduleParticipant[] = roster.map((e, i) => ({
    employeeId: e.id,
    carryOver: SAMPLE[i]?.carryOver ?? 0,
    acknowledged: false,
  }));

  const cells: Schedule["cells"] = {};
  roster.forEach((e, i) => {
    const row: Record<number, { codeId: string }> = {};
    for (const [day, codeId] of Object.entries(patternMonth(e.pattern, year, month))) {
      row[Number(day)] = { codeId };
    }
    // Последният е в отпуск от 7 до 20 — блокът се рисува непрекъснато,
    // както на хартия, а часове се начисляват само за работните дни.
    if (SAMPLE[i]?.pattern === "leave" && DO) {
      for (let d = 7; d <= 20; d++) row[d] = { codeId: DO };
    }
    cells[e.id] = row;
  });


  return {
    id: scheduleId(year, month),
    header: { ...DEFAULT_HEADER, normHours: wd * 8 },
    participants,
    cells,
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
}
