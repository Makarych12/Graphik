"use client";

import { resolved, useApp, type CellChange } from "@/lib/store";
import { calcAll, calcCell } from "@/lib/calc";
import { validateSchedule } from "@/lib/validation";
import { validateTrips, calcTrip } from "@/lib/trips";
import { describePattern } from "@/lib/patterns";
import { countWorkingDays, daysInMonth, formatHours, weekdayName } from "@/lib/time";

/** Описания на инструментите, изпращани към модела (OpenAI-съвместим формат). */
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_schedule",
      description:
        "Връща шапката на графика, състава на бригадата, попълнените клетки по дни и изчисления итог за всеки служител. Използвай го преди всеки анализ или предложение.",
      parameters: {
        type: "object",
        properties: {
          includeCells: { type: "boolean", description: "Да включи ли попълнените клетки по дни. По подразбиране true." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_codes",
      description: "Връща легендата на кодовете за смени и отсъствия с часовете им.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_validation",
      description: "Пуска правния двигател върху текущия график и връща списък с нарушенията, предупрежденията и бележките с препратка към членовете на Наредба № 50.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trips",
      description: "Връща повеските (модул „Рейси“) за текущия месец с изчислените времена и правната им проверка.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_cell_changes",
      description:
        "Предлага промени в клетките на графика. Промените НЕ се прилагат веднага — нарядчикът вижда предпросмотър и потвърждава. Използвай кодовете от легендата (полето code, напр. \"3\", \"ДО\"). За изчистване на клетка подай code: null.",
      parameters: {
        type: "object",
        required: ["summary", "changes"],
        properties: {
          summary: { type: "string", description: "Кратко обяснение какво и защо се променя." },
          clearFirst: { type: "boolean", description: "Да изчисти ли целия месец за засегнатите служители преди прилагането (пълно преизчисляване)." },
          changes: {
            type: "array",
            items: {
              type: "object",
              required: ["day"],
              properties: {
                employeeId: { type: "string", description: "id на служителя от get_schedule." },
                employeeName: { type: "string", description: "Име, ако id не е известно." },
                day: { type: "integer", description: "Ден от месеца (1..31)." },
                code: { type: ["string", "null"], description: "Код от легендата или null за изчистване." },
                extensionApproved: { type: "boolean", description: "Оформено удължаване по чл.14." },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_header_changes",
      description: "Предлага промени в шапката на графика (норма, работни дни, наименования, подписи).",
      parameters: {
        type: "object",
        required: ["summary", "header"],
        properties: {
          summary: { type: "string" },
          header: {
            type: "object",
            properties: {
              organization: { type: "string" },
              department: { type: "string" },
              brigade: { type: "string" },
              normHours: { type: "number" },
            },
          },
        },
      },
    },
  },
] as const;

export type ToolResult = { name: string; content: string };

function findEmployee(name?: string, id?: string) {
  const list = useApp.getState().employees;
  if (!list.length) return null;
  if (id) {
    const byId = list.find((e) => e.id === id);
    if (byId) return byId;
  }
  if (name) {
    const n = name.trim().toLowerCase();
    return (
      list.find((e) => e.name.toLowerCase() === n) ??
      list.find((e) => e.name.toLowerCase().includes(n)) ??
      list.find((e) => e.serviceNo === name) ??
      null
    );
  }
  return null;
}

/** Изпълнява едно извикване на инструмент върху текущото състояние на приложението. */
export function runTool(name: string, args: Record<string, unknown>): string {
  const st = useApp.getState();
  const { settings, tripBoard, roster, employees } = st;
  const schedule = resolved(st);
  if (!schedule) return JSON.stringify({ error: "Няма зареден график." });

  switch (name) {
    case "get_schedule": {
      const includeCells = args.includeCells !== false;
      const totals = calcAll(schedule, settings);
      const dim = daysInMonth(schedule.header.year, schedule.header.month);
      return JSON.stringify({
        header: schedule.header,
        status: schedule.status,
        daysInMonth: dim,
        calendarWorkingDays: countWorkingDays(schedule.header.year, schedule.header.month),
        rosterNotInThisMonth: roster
          .filter((r) => !employees.some((e) => e.id === r.id))
          .map((r) => ({ id: r.id, name: r.name, position: r.position, active: r.active })),
        weekdays: Object.fromEntries(
          Array.from({ length: dim }, (_, i) => [i + 1, weekdayName(schedule.header.year, schedule.header.month, i + 1)]),
        ),
        employees: schedule.employees.map((e) => {
          const t = totals[e.id];
          const row = schedule.cells[e.id] ?? {};
          const cells = includeCells
            ? Object.fromEntries(
                Object.entries(row).map(([d, c]) => [
                  d,
                  settings.codes.find((x) => x.id === c.codeId)?.code ?? "?",
                ]),
              )
            : undefined;
          return {
            id: e.id,
            serviceNo: e.serviceNo,
            name: e.name,
            position: e.position,
            dailyNorm: e.dailyNorm,
            annualLeaveDays: e.annualLeaveDays,
            carryOver: e.carryOver,
            /** Базов шаблон на смените (D.2.1) — черновата, върху която се работи. */
            shablon: describePattern(e.pattern, settings),
            /**
             * Ако е попълнено: отрицателният остатък идва от ползван отпуск в
             * посочения месец и трябва да се покрие с доработки (кодове 4–9).
             */
            dorabotkaSledOtpusk: e.carryOverReason
              ? {
                  otMesec: e.carryOverReason.fromMonth,
                  chasove: +e.carryOverReason.hours.toFixed(2),
                  dniOtpusk: e.carryOverReason.leaveDays,
                }
              : null,
            acknowledged: e.acknowledged,
            cells,
            totals: {
              rabotniDni: t.workDays,
              otraboteni: +t.worked.toFixed(2),
              nostenTrud: +t.night.toFixed(2),
              priravnenNostenTrud: +t.nightEqualized.toFixed(2),
              trudVPraznik: +t.holidayHours.toFixed(2),
              polzvanOtpusk: +t.leave.toFixed(2),
              polzvanMO: +t.sick.toFixed(2),
              obshtoChasove: +t.total.toFixed(2),
              norma: +t.norm.toFixed(2),
              razlikaZaMeseca: +t.diff.toFixed(2),
              ostatakZaSledvashtMesec: +t.carryForward.toFixed(2),
            },
          };
        }),
      });
    }

    case "get_codes":
      return JSON.stringify(
        settings.codes.map((c) => ({
          code: c.code, label: c.label, category: c.category,
          start: c.start, end: c.end, hours: c.hours,
          breaks: c.breaks,
        })),
      );

    case "get_validation": {
      const v = validateSchedule(schedule, settings);
      return JSON.stringify(
        v.map((x) => ({
          severity: x.severity, article: x.article, message: x.message,
          employee: schedule.employees.find((e) => e.id === x.employeeId)?.name,
          employeeId: x.employeeId, day: x.day,
        })),
      );
    }

    case "get_trips": {
      const trips = tripBoard?.trips ?? [];
      const v = validateTrips(trips, schedule.employees, settings);
      return JSON.stringify({
        trips: trips.map((t) => {
          const c = calcTrip(t, settings);
          return {
            id: t.id,
            employee: schedule.employees.find((e) => e.id === t.employeeId)?.name,
            mode: t.mode, international: t.international,
            yavka: t.yavka, release: t.release,
            outHours: c.outHours, turnaroundHours: c.turnaroundHours, backHours: c.backHours,
            workHours: +c.workHours.toFixed(2), nightHours: +c.nightHours.toFixed(2),
            restRoom: t.restRoom,
          };
        }),
        violations: v.map((x) => ({ severity: x.severity, article: x.article, message: x.message })),
      });
    }

    case "propose_cell_changes": {
      const raw = (args.changes ?? []) as Array<Record<string, unknown>>;
      const changes: CellChange[] = [];
      const problems: string[] = [];

      if (args.clearFirst) {
        const touched = new Set<string>();
        for (const ch of raw) {
          const emp = findEmployee(ch.employeeName as string, ch.employeeId as string);
          if (emp) touched.add(emp.id);
        }
        const dim = daysInMonth(schedule.header.year, schedule.header.month);
        for (const empId of touched) {
          for (let d = 1; d <= dim; d++) {
            if (schedule.cells[empId]?.[d]) {
              changes.push({ employeeId: empId, day: d, from: schedule.cells[empId][d], to: null });
            }
          }
        }
      }

      for (const ch of raw) {
        const emp = findEmployee(ch.employeeName as string, ch.employeeId as string);
        if (!emp) { problems.push(`Не е намерен служител: ${ch.employeeName ?? ch.employeeId}`); continue; }
        const day = Number(ch.day);
        if (!day || day < 1 || day > daysInMonth(schedule.header.year, schedule.header.month)) {
          problems.push(`Невалиден ден ${ch.day} за ${emp.name}`); continue;
        }
        const codeStr = ch.code as string | null | undefined;
        const from = schedule.cells[emp.id]?.[day] ?? null;
        if (codeStr === null || codeStr === undefined || codeStr === "") {
          changes.push({ employeeId: emp.id, day, from, to: null });
          continue;
        }
        const code = settings.codes.find((c) => c.code.toLowerCase() === String(codeStr).toLowerCase());
        if (!code) { problems.push(`Няма код "${codeStr}" в легендата`); continue; }
        changes.push({
          employeeId: emp.id, day, from,
          to: {
            codeId: code.id,
            ...(ch.extensionApproved !== undefined ? { extension: { approved: Boolean(ch.extensionApproved) } } : {}),
          },
        });
      }

      // Изчистваме промените, които не променят нищо.
      const effective = changes.filter((c) => (c.from?.codeId ?? null) !== (c.to?.codeId ?? null) || c.to?.extension?.approved !== c.from?.extension?.approved);

      if (!effective.length) {
        return JSON.stringify({
          applied: false,
          message: "Няма реални промени за прилагане.",
          problems,
        });
      }

      st.proposePatch({ summary: String(args.summary ?? "Промени в графика"), cells: effective, source: "ai" });

      return JSON.stringify({
        applied: false,
        awaitingConfirmation: true,
        message:
          "Предложението е показано на нарядчика като предпросмотър и чака потвърждение. Не твърди, че промяната вече е направена.",
        changeCount: effective.length,
        problems,
        preview: effective.slice(0, 40).map((c) => ({
          employee: schedule.employees.find((e) => e.id === c.employeeId)?.name,
          day: c.day,
          from: settings.codes.find((x) => x.id === c.from?.codeId)?.code ?? "—",
          to: settings.codes.find((x) => x.id === c.to?.codeId)?.code ?? "—",
        })),
      });
    }

    case "propose_header_changes": {
      st.proposePatch({
        summary: String(args.summary ?? "Промени в шапката"),
        cells: [],
        header: args.header as Record<string, unknown>,
        source: "ai",
      });
      return JSON.stringify({ applied: false, awaitingConfirmation: true, message: "Предложението чака потвърждение от нарядчика." });
    }

    default:
      return JSON.stringify({ error: `Непознат инструмент: ${name}` });
  }
}

/** Кратко текстово резюме на състоянието — прикача се към първото съобщение. */
export function contextSummary(): string {
  const st = useApp.getState();
  const { settings } = st;
  const schedule = resolved(st);
  if (!schedule) return "";
  const totals = calcAll(schedule, settings);
  const v = validateSchedule(schedule, settings);
  const errors = v.filter((x) => x.severity === "error").length;
  const lines = schedule.employees.map((e) => {
    const t = totals[e.id];
    const dor = e.carryOverReason
      ? ` ⚠ ДОРАБОТКА след отпуск от ${e.carryOverReason.fromMonth}: ${formatHours(e.carryOverReason.hours)} ч.`
      : "";
    return `- ${e.name || "(без име)"} (${e.position}): общо ${formatHours(t.total)} ч. при норма ${formatHours(t.norm)} ч., (+/−) ${formatHours(t.diff)} ч., ${t.workDays} работни дни.${dor}`;
  });
  const priority = schedule.employees.filter((e) => e.carryOverReason);
  return [
    `Текущ график: ${schedule.header.brigade}, ${schedule.header.month}/${schedule.header.year}.`,
    `Норма ${formatHours(schedule.header.normHours, 0)} ч. (производствен календар: ${countWorkingDays(schedule.header.year, schedule.header.month)} работни дни), статус: ${schedule.status}.`,
    `Служители: ${schedule.employees.length}. Нарушения от правния двигател: ${errors}.`,
    ...lines,
    ...(priority.length
      ? [
          "",
          `ПРИОРИТЕТ: ${priority.length} служители влизат в месеца с минус от ползван отпуск. ` +
            "На тях първо предложи разстановка на доработки (кодове 4–9), за да покрият часовете.",
        ]
      : []),
  ].join("\n");
}

export { calcCell };
