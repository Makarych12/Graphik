import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Проверка на доменната логика срещу реалния бланк и текста на Наредба № 50.
// Пуска се с:  npm run verify
const L = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib") + "/").href;
const { calcCell, calcEmployee } = await import(L + "calc.ts");
const { validateSchedule } = await import(L + "validation.ts");
const { DEFAULT_SETTINGS, DEFAULT_CODES } = await import(L + "defaults.ts");
const { calcTrip, validateTrips, nextAllowedYavka } = await import(L + "trips.ts");
const { countWorkingDays } = await import(L + "time.ts");

let pass = 0, fail = 0;
const eq = (name, got, want, tol = 0.001) => {
  const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  OK " : "FAIL "} ${name}: получено ${got}${ok ? "" : `, очаквано ${want}`}`);
};

const settings = {
  ...DEFAULT_SETTINGS,
  codes: [...DEFAULT_CODES, {
    id: "cn", code: "Н", label: "Нощна смяна", category: "work",
    start: "20:00", end: "08:00", hours: 11, breaks: [{ start: "00:00", end: "01:00", kind: "pochivka" }],
    color: "#000",
  }],
};
// Служителят вече е обединение на запис от справочника и участие в месеца.
const emp = { id: "e1", serviceNo: "1", name: "Тест", position: "x", annualLeaveDays: 20, carryOver: -10, dailyNorm: 8, acknowledged: false };
const header = {
  organization: "", department: "", brigade: "", month: 9, year: 2026,
  normHours: 160,
  preparedBy: { name: "", position: "" }, agreedBy: { name: "", position: "" }, approvedBy: { name: "", position: "" },
};
// Разрешен график: това получават изчисленията и правният двигател.
const sch = (cells) => ({ id: "2026-09", header, employees: [emp], cells: { e1: cells }, status: "draft", updatedAt: "" });

console.log("\n— Производствен календар —");
eq("работни дни 09/2026 (реалният бланк: 20)", countWorkingDays(2026, 9), 20);
eq("норма 09/2026", countWorkingDays(2026, 9) * 8, 160);

console.log("\n— Нощен труд и приравняване (C.5) —");
const night = calcCell({ codeId: "cn" }, 1, emp, settings, header);
// 20:00–22:00 не е нощен труд; нощни са 22:00–06:00 = 8 ч., минус почивката 00:00–01:00.
eq("нощни часове на смяна 20:00–08:00 без почивката 00:00–01:00", night.nightHours, 7);
eq("отработени часове по легендата", night.workHours, 11);
const t1 = calcEmployee(sch({ 1: { codeId: "cn" } }), emp, settings);
eq("приравнен нощен труд = 7 × 8/7", t1.nightEqualized, 7 * 8 / 7);
eq("общо часове = 11 + (приравняване − сурови)", t1.total, 11 + (7 * 8 / 7 - 7));
eq("остатък за следващ месец", t1.carryForward, -10 + (11 + (7 * 8 / 7 - 7)) - 160);

console.log("\n— Отпуск само в работни дни —");
const leaveCells = {};
for (let d = 5; d <= 11; d++) leaveCells[d] = { codeId: "cdo" }; // 5–11 септ. 2026
const t2 = calcEmployee(sch(leaveCells), emp, settings);
// 5=събота, 6=неделя(празник), 7=преместен празник, 8–11 работни → 4 дни × 8 ч.
eq("ползван отпуск за блок 5–11 септември", t2.leave, 32);

console.log("\n— Правен двигател (D.6) —");
const v1 = validateSchedule(sch({ 1: { codeId: "c9" }, 2: { codeId: "c9" } }), settings);
eq("код 9 (12 ч.) не нарушава чл.13", v1.filter((x) => x.article.includes("чл.13")).length, 0);
const long = { ...settings, codes: settings.codes.map((c) => c.id === "c9" ? { ...c, hours: 13 } : c) };
const v2 = validateSchedule(sch({ 1: { codeId: "c9" } }), long);
eq("13 ч. без заповед → нарушение по чл.14", v2.filter((x) => x.article.includes("чл.14")).length, 1);
const v3 = validateSchedule(sch({ 1: { codeId: "c9", extension: { approved: true } } }), long);
eq("13 ч. с оформено удължаване → без нарушение", v3.filter((x) => x.severity === "error" && x.article.includes("чл.14")).length, 0);

const v4 = validateSchedule(sch({ 1: { codeId: "cn" }, 2: { codeId: "c3" } }), settings);
// нощна 20:00 (д.1) → 08:00 (д.2); следваща смяна 07:30 на д.2 → почивка е отрицателна
eq("междусменна почивка под 12 ч. → чл.16", v4.filter((x) => x.article === "чл.16").length, 1);

const three = { 1: { codeId: "cn" }, 2: { codeId: "cn" }, 3: { codeId: "cn" } };
const v5 = validateSchedule(sch(three), settings);
eq("3 последователни нощни смени → чл.15 ал.3", v5.filter((x) => x.article === "чл.15 ал.3").length, 1);

console.log("\n— Повески (чл.17) —");
const iso = (d, h, m = 0) => new Date(2026, 8, d, h, m).toISOString();
const trip = {
  id: "t1", employeeId: "e1", mode: "named", international: false,
  yavka: iso(1, 6), arrivalTurnaround: iso(1, 14), departureTurnaround: iso(1, 20),
  release: iso(2, 4), restRoom: true,
};
const c = calcTrip(trip, settings);
eq("време натам", c.outHours, 8);
eq("престой в оборота", c.turnaroundHours, 6);
eq("време обратно", c.backHours, 8);
eq("изисквана почивка в оборота = 75% от 8 ч.", c.requiredTurnaroundRest, 6);
eq("престоят >2 ч. при стая за отдих не е работно време", c.turnaroundIsWork, false);
eq("работно време на повеската", c.workHours, 16);
const tv = validateTrips([trip], [emp], settings);
eq("почивка 6 ч. = точно 75% → без нарушение по чл.17", tv.filter((x) => x.article === "чл.17" && x.severity === "error").length, 0);

const short = { ...trip, departureTurnaround: iso(1, 19), release: iso(2, 3) };
const tv2 = validateTrips([short], [emp], settings);
eq("почивка 5 ч. (<75%) → нарушение по чл.17", tv2.filter((x) => x.article === "чл.17" && x.severity === "error").length >= 1, true);

const na = nextAllowedYavka(trip, settings);
eq("безизвикателна система: следваща явка = освобождаване + 12 ч.", na.iso, new Date(new Date(trip.release).getTime() + 12 * 3600000).toISOString());

console.log("\n— Граница от 12 ч. при повеска с истинска почивка в оборота —");
const tv3 = validateTrips([trip], [emp], settings);
eq("8 ч. натам + 8 ч. обратно, разделени от 6 ч. почивка → без нарушение по чл.13",
   tv3.filter((x) => x.article.includes("чл.13")).length, 0);

const noRoom = { ...trip, restRoom: false };
const cNoRoom = calcTrip(noRoom, settings);
eq("без стая за отдих целият престой е работно време", cNoRoom.workHours, 22);
const tv4 = validateTrips([noRoom, ], [emp], settings);
eq("без стая за отдих 22 ч. → нарушение по чл.13/чл.14",
   tv4.filter((x) => x.article.includes("чл.13") || x.article.includes("чл.14")).length >= 1, true);

const longLeg = { ...trip, arrivalTurnaround: iso(1, 19), departureTurnaround: iso(2, 2), release: iso(2, 10) };
const tv5 = validateTrips([longLeg], [emp], settings);
eq("частта „натам“ 13 ч. → нарушение по чл.13/чл.14",
   tv5.filter((x) => x.article.includes("чл.13")).length, 1);

console.log("\n— Разделяне на справочник и месец —");
const { migrateSchedule, mergeRoster } = await import(L + "db.ts");
const legacy = {
  id: "2026-08",
  header: { ...header, month: 8, workingDays: 21 },
  employees: [{ ...emp, id: "x1", carryOver: -40 }],
  cells: { x1: { 3: { codeId: "c3" } } },
  status: "draft",
  updatedAt: "",
};
const mig = migrateSchedule(legacy);
eq("старият формат изважда служителя в справочника", mig.roster.length, 1);
eq("справочникът пази личните данни", mig.roster[0].name, "Тест");
eq("месецът пази само участието", mig.schedule.participants[0].carryOver, -40);
eq("клетките остават непокътнати", Object.keys(mig.schedule.cells.x1).length, 1);
eq("РАБОТНИ ДНИ отпада от шапката", mig.schedule.header.workingDays, undefined);
eq("повторна миграция не дублира", migrateSchedule(mig.schedule).roster.length, 0);
eq("сливането на справочници не дублира по id",
   mergeRoster(mig.roster, [{ ...mig.roster[0] }, { ...mig.roster[0], id: "x2" }]).length, 2);

console.log("\n— Фактически работни дни са индивидуални —");
const busy = {}; for (let d = 1; d <= 10; d++) busy[d] = { codeId: "c3" };
const tBusy = calcEmployee(sch(busy), emp, settings);
eq("10 попълнени работни кода → 10 работни дни", tBusy.workDays, 10);
const mixed = { 1: { codeId: "c3" }, 2: { codeId: "cdo" }, 3: { codeId: "cb" }, 4: { codeId: "cya" } };
const tMixed = calcEmployee(sch(mixed), emp, settings);
eq("отпуск, болничен и неявка не са работни дни", tMixed.workDays, 1);
eq("отпускът се брои отделно", tMixed.leaveDays, 1);

console.log("\n— Нормата следва производствения календар —");
const vNorm = validateSchedule({ ...sch({}), header: { ...header, normHours: 176 } }, settings);
eq("норма 176 при календарни 160 → бележка", vNorm.filter((x) => x.id === "header-norm").length, 1);
eq("норма 160 → без бележка", validateSchedule(sch({}), settings).filter((x) => x.id === "header-norm").length, 0);

console.log("\n— Официални празници и труд в празник (B.10, чл.264 КТ) —");
const H = await import(L + "holidays.ts");
const H2 = H;
const T = await import(L + "time.ts");
const { syncParticipants } = await import(L + "store.ts");

eq("22.09.2026 е официален празник", H.isHoliday(2026, 9, 22), true);
eq("07.09.2026 е преместен празник", H.holidayName(2026, 9, 7), "Съединение на България (преместен)");
eq("празникът се вади от нормата само веднъж", T.countWorkingDays(2026, 9), 20);

// Работа на 22 септември — празник, паднал се във вторник.
const onHoliday = calcCell({ codeId: "c3" }, 22, emp, settings, header);
eq("часовете в празник се отчитат отделно", onHoliday.holidayHours, 8);
eq("но остават и в отработените часове", onHoliday.workHours, 8);
const tHol = calcEmployee(sch({ 21: { codeId: "c3" }, 22: { codeId: "c3" } }), emp, settings);
eq("общо празнични часове за месеца", tHol.holidayHours, 8);
eq("дни с труд в празник", tHol.holidayDays, 1);
eq("„Общо часове“ не удвоява празничните часове", tHol.total, 16);
eq("труд в празник → бележка по чл.264 КТ",
   validateSchedule(sch({ 22: { codeId: "c3" } }), settings).filter((x) => x.article === "чл.264 КТ").length, 1);

// Ръчни поправки на календара.
H.setHolidayOverrides({ "2026": [{ date: "2026-09-22", name: "Ден на независимостта", removed: true }] });
eq("обявен за работен → изчезва от празниците", H.isHoliday(2026, 9, 22), false);
eq("работните дни стават 21", T.countWorkingDays(2026, 9), 21);
H.setHolidayOverrides({ "2026": [{ date: "2026-09-15", name: "Еднократен неработен ден" }] });
eq("добавен неработен ден → 19 работни дни", T.countWorkingDays(2026, 9), 19);
eq("името идва от поправката", H.holidayName(2026, 9, 15), "Еднократен неработен ден");
H.setHolidayOverrides({});
eq("след изчистване на поправките — пак 20", T.countWorkingDays(2026, 9), 20);

console.log("\n— Подтегляне на състава при отваряне на месец —");
const rosterList = [
  { id: "r1", serviceNo: "1", name: "Активен", position: "p", annualLeaveDays: 20, dailyNorm: 8, active: true },
  { id: "r2", serviceNo: "2", name: "Нов", position: "p", annualLeaveDays: 20, dailyNorm: 8, active: true },
  { id: "r3", serviceNo: "3", name: "Извън състав", position: "p", annualLeaveDays: 20, dailyNorm: 8, active: false },
];
const old = { id: "2026-10", header: { ...header, month: 10 }, participants: [{ employeeId: "r1", carryOver: 0, acknowledged: false }], cells: {}, status: "draft", updatedAt: "" };
const synced = syncParticipants(old, rosterList);
eq("новият от справочника влиза в стар месец", synced.participants.length, 2);
eq("извън състава не влиза", synced.participants.some((p) => p.employeeId === "r3"), false);
const withExcluded = syncParticipants({ ...old, excluded: ["r2"] }, rosterList);
eq("изрично извадените не се връщат сами", withExcluded.participants.length, 1);
eq("без промяна връща същия обект", syncParticipants(synced, rosterList) === synced, true);

console.log("\n— Базови шаблони на смените (D.2.1) —");
const P = await import(L + "patterns.ts");
const c1 = DEFAULT_CODES.find((c) => c.code === "1").id;
const c2 = DEFAULT_CODES.find((c) => c.code === "2").id;
const c3 = DEFAULT_CODES.find((c) => c.code === "3").id;

const cyc = { kind: "cycle2x2", anchor: "2026-09-01", codeIds: [c1] };
const dayOf = (p, y, m, d) => P.patternCodeIdFor(p, y, m, d);
eq("1 септ. — работен (начало на цикъла)", dayOf(cyc, 2026, 9, 1), c1);
eq("2 септ. — работен", dayOf(cyc, 2026, 9, 2), c1);
eq("3 септ. — почивен", dayOf(cyc, 2026, 9, 3), null);
eq("4 септ. — почивен", dayOf(cyc, 2026, 9, 4), null);
eq("5 септ. — пак работен", dayOf(cyc, 2026, 9, 5), c1);
eq("цикълът е само дневни смени", DEFAULT_CODES.find((c) => c.id === c1).start, "07:30");

console.log("  · непрекъснатост през месеците");
eq("29 септ. работен", dayOf(cyc, 2026, 9, 29), c1);
eq("30 септ. работен", dayOf(cyc, 2026, 9, 30), c1);
eq("1 окт. почивен — цикълът НЕ се нулира на 1-во число", dayOf(cyc, 2026, 10, 1), null);
eq("2 окт. почивен", dayOf(cyc, 2026, 10, 2), null);
eq("3 окт. работен", dayOf(cyc, 2026, 10, 3), c1);
eq("работни дни за октомври по цикъла", Object.keys(P.patternMonth(cyc, 2026, 10)).length, 15);

console.log("  · редуване на I и II смяна при два кода");
const cyc2 = { kind: "cycle2x2", anchor: "2026-09-01", codeIds: [c1, c2] };
eq("дни 1–2 → I смяна", `${dayOf(cyc2, 2026, 9, 1)},${dayOf(cyc2, 2026, 9, 2)}`, `${c1},${c1}`);
eq("дни 3–4 → почивни", `${dayOf(cyc2, 2026, 9, 3)},${dayOf(cyc2, 2026, 9, 4)}`, "null,null");
eq("дни 5–6 → II смяна", `${dayOf(cyc2, 2026, 9, 5)},${dayOf(cyc2, 2026, 9, 6)}`, `${c2},${c2}`);
eq("дни 9–10 → пак I смяна", `${dayOf(cyc2, 2026, 9, 9)},${dayOf(cyc2, 2026, 9, 10)}`, `${c1},${c1}`);

console.log("  · редовна смяна понеделник–петък");
const wd = { kind: "weekdays", codeId: c3 };
eq("4 септ. (петък) — работен", dayOf(wd, 2026, 9, 4), c3);
eq("5 септ. (събота) — почивен", dayOf(wd, 2026, 9, 5), null);
eq("6 септ. (неделя) — почивен", dayOf(wd, 2026, 9, 6), null);
eq("работни дни за септември", Object.keys(P.patternMonth(wd, 2026, 9)).length, 22);

console.log("\n— Празникът не прекъсва шаблона —");
eq("7 септ. е официален празник", H2.isHoliday(2026, 9, 7), true);
eq("но по редовната смяна остава работен", dayOf(wd, 2026, 9, 7), c3);
eq("22 септ. е празник", H2.isHoliday(2026, 9, 22), true);
eq("и по редовната смяна е работен", dayOf(wd, 2026, 9, 22), c3);
eq("и по цикъла 2 през 2 е работен", dayOf(cyc, 2026, 9, 22), c1);
const monthWd = P.patternMonth(wd, 2026, 9);
const holidayShifts = Object.keys(monthWd).filter((d) => H2.isHoliday(2026, 9, Number(d)));
eq("смени, паднали се в празник", holidayShifts.join(","), "7,22");
// Часовете в тези дни се удвояват автоматично.
const wdCells = {}; for (const [d, id] of Object.entries(monthWd)) wdCells[d] = { codeId: id };
const tWd = calcEmployee(sch(wdCells), emp, settings);
eq("труд в празник = 2 смени по 8 ч.", tWd.holidayHours, 16);
eq("работни дни по шаблона", tWd.workDays, 22);
eq("часове над нормата, защото празниците са отработени", tWd.total - tWd.norm, 16);

console.log("\n— Доработка след отпуск: предпоставката за бейджа —");
const DO_ID = DEFAULT_CODES.find((c) => c.code === "ДО").id;
// Отпуск от 8 до 18 септември плюс само четири отработени дни в началото:
// месецът свършва под нормата именно заради отпуска.
const leaveMonth = { 1: { codeId: c3 }, 2: { codeId: c3 }, 3: { codeId: c3 }, 4: { codeId: c3 } };
for (let d = 8; d <= 18; d++) leaveMonth[d] = { codeId: DO_ID };
const tLeave = calcEmployee(sch(leaveMonth), emp, settings);
eq("отпускът се брои само в работни дни", tLeave.leave, 72);
eq("отработени часове", tLeave.worked, 32);
eq("има ползван отпуск", tLeave.leaveDays > 0, true);
eq("и минус спрямо нормата", tLeave.diff, -56);
eq("минусът отива в остатъка за следващия месец", tLeave.carryForward, -66);

// Обратният случай: пълен месец по шаблон — отпускът се компенсира и няма минус,
// значи бейджът с право не се показва.
const fullLeave = { ...leaveMonth };
for (const [d, id] of Object.entries(monthWd)) if (!fullLeave[d]) fullLeave[d] = { codeId: id };
const tFull = calcEmployee(sch(fullLeave), emp, settings);
eq("при пълен месец отпускът не прави минус", tFull.diff >= 0, true);

console.log(`\nРезултат: ${pass} успешни, ${fail} неуспешни`);
process.exit(fail ? 1 : 0);
