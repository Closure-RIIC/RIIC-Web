"use client";

import { useState } from "react";

import type { AgentPlanProjection } from "@/server/agent/plan-artifact";

const ROOM_TYPE_LABELS: Record<string, string> = {
  control: "控制中枢",
  trading: "贸易站",
  manufacture: "制造站",
  power: "发电站",
  dormitory: "宿舍",
  meeting: "会客室",
  hire: "办公室",
  processing: "加工站",
};

function roomLabel(room: string): string {
  const match = room.match(/^([a-z]+)(\d+)$/);
  if (!match) return room;
  const [, type, index] = match;
  return `${ROOM_TYPE_LABELS[type] ?? type} ${index}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recommendationLine(item: unknown): string {
  const record = asRecord(item);
  if (!record) return String(item);
  const operator = String(record.operator ?? "?");
  const action = String(record.action ?? "");
  const target = asRecord(record.target);
  const targetText = target ? `${target.kind === "elite" ? `精二` : ""}${target.level != null ? ` Lv.${target.level}` : ""}` : "";
  const combination = record.combination_name ? String(record.combination_name) : null;
  const reason = record.reason ? String(record.reason).slice(0, 80) : null;
  return [operator, action, targetText, combination ? `（${combination}）` : null, reason ? `——${reason}` : null]
    .filter(Boolean)
    .join(" ");
}

export function PlanArtifactView({ plan, dense = false }: { plan: AgentPlanProjection; dense?: boolean }) {
  const [activeShift, setActiveShift] = useState(0);
  const shift = plan.plans[activeShift] ?? plan.plans[0];
  const production = plan.dailyProduction;
  const productionEntries = Object.entries(production).filter(([key, value]) =>
    typeof value === "number" && !key.startsWith("baseline"));
  const recommendations = plan.trainingAdvice?.recommendations ?? [];

  return (
    <div className={dense ? "grid gap-2" : "grid gap-4"} data-plan-artifact-view>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>布局 <span className="font-medium text-foreground">{String(plan.layoutLabel ?? "?")}</span></span>
        <span>{String(plan.operboxLabel ?? "")}</span>
        <span>求解 {String(plan.durationMs ?? "?")} ms</span>
        {productionEntries.length > 0 ? (
          <span className="font-number">
            {productionEntries.map(([key, value]) => `${key} ${value}`).join(" · ")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="班次切换">
        {plan.plans.map((item, index) => (
          <button
            key={item.shift}
            type="button"
            role="tab"
            aria-selected={index === activeShift}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              index === activeShift ? "border-transparent bg-[#FFD501] font-medium text-black" : "hover:bg-muted"
            }`}
            onClick={() => setActiveShift(index)}
          >
            第 {item.shift} 班{item.name ? ` · ${item.name}` : ""}
          </button>
        ))}
      </div>

      {shift ? (
        <div className={dense ? "grid gap-1" : "grid gap-1.5"}>
          {shift.rooms.map((room) => (
            <div
              key={room.room}
              className={`flex items-baseline gap-2 rounded border bg-muted/30 ${dense ? "px-2 py-1" : "px-2.5 py-1.5"}`}
            >
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{roomLabel(room.room)}</span>
              <span className="font-number min-w-0 text-sm">
                {room.operators.join("、") || "（未安排干员）"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <details className="rounded border bg-muted/20 px-2.5 py-1.5">
          <summary className="cursor-pointer select-none text-xs font-medium">
            练卡建议（{recommendations.length} 条）
          </summary>
          <ul className="mt-1.5 grid gap-1 text-xs leading-5">
            {recommendations.map((item, index) => (
              <li key={index} className="text-muted-foreground">{recommendationLine(item)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
