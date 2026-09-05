"use client";

import { useMemo, useRef, useState } from "react";
import { useApp, useResolved } from "@/lib/store";
import ScheduleGrid from "@/components/schedule/ScheduleGrid";
import DocumentHeader, { SignatureBlock } from "@/components/schedule/DocumentHeader";
import EmployeeEditor from "@/components/schedule/EmployeeEditor";
import ValidationPanel from "@/components/schedule/ValidationPanel";
import Legend from "@/components/schedule/Legend";
import Toolbar from "@/components/schedule/Toolbar";
import SaveBar from "@/components/schedule/SaveBar";
import ChatPanel from "@/components/ai/ChatPanel";
import PatchPreview from "@/components/ai/PatchPreview";
import { validateSchedule } from "@/lib/validation";
import { Reveal, Swap } from "@/components/motion";

export default function SmeniPage() {
  const { settings, employees, pendingPatch } = useApp();
  const schedule = useResolved();
  const [editEmployee, setEditEmployee] = useState<string | null>(null);
  const [ai, setAi] = useState(false);

  const violations = useMemo(
    () => (schedule ? validateSchedule(schedule, settings) : []),
    [schedule, settings],
  );

  // Посоката на плъзгането следва посоката на смяната на месеца.
  const prevMonth = useRef<string | null>(null);
  const monthId = schedule?.id ?? "";
  const direction = prevMonth.current && prevMonth.current !== monthId
    ? (monthId > prevMonth.current ? 1 : -1)
    : 0;
  if (monthId) prevMonth.current = monthId;

  if (!schedule) return null;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Toolbar onToggleAI={() => setAi(!ai)} aiOpen={ai} />

        {/* Шапката и мрежата се сменят заедно при смяна на месеца — плъзгат се
            в посоката на движение. Самите клетки не се анимират: при
            въвеждане на код реакцията трябва да е мигновена. */}
        <Swap id={monthId} direction={direction} distance={26}>
          <DocumentHeader />

          {employees.length === 0 && (
            <div className="card no-print" style={{ padding: 14, marginBottom: 10, color: "var(--text-dim)" }}>
              В графика за този месец няма служители. Изберете ги с бутона „Състав за месеца“ —
              мрежата на дните вече е готова. Самият справочник се води в „Настройки → Служители“.
            </div>
          )}
          {/* Мрежата се показва винаги: дните на месеца трябва да се виждат и когато
              съставът още е празен. */}
          <ScheduleGrid onEditEmployee={setEditEmployee} />
        </Swap>

        {!ai && pendingPatch && <PatchPreview />}

        <ValidationPanel
          violations={violations}
          employees={employees}
          onGoTo={(id) => setEditEmployee(id)}
        />

        <Reveal delay={0.04}><Legend /></Reveal>
        <SignatureBlock />
        <SaveBar />

        <p className="no-print" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 14, maxWidth: 780 }}>
          Проверките се основават на Наредба № 50 (изм. ДВ бр.46/2004, бр.99/2006) —
          законовия минимум. Вътрешният Правилник за вътрешния трудов ред на превозвача
          може да съдържа по-строги изисквания; те не са отразени тук.
        </p>
      </div>

      {ai && <ChatPanel onClose={() => setAi(false)} />}

      {editEmployee && <EmployeeEditor id={editEmployee} onClose={() => setEditEmployee(null)} />}
    </div>
  );
}
