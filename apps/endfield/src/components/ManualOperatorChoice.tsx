import type { Operator } from "@riic/endfield-solver/model.mjs";
import { useId, useState } from "react";
import { skillTiersOf, type DisplayOperator } from "@riic/endfield-data";
import { unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@riic/ui-primitives/tooltip";
import { useWorkspace } from "../state";
import { GameArtwork, OperatorPortrait } from "./GameArtwork";

export function ManualOperatorChoice({ operator, owned, selected, unavailable, unavailableLabel, onSelect }: {
  operator: DisplayOperator;
  owned: Operator;
  selected: boolean;
  unavailable: boolean;
  unavailableLabel?: string;
  onSelect: () => void;
}) {
  const { locale, t, ready } = useWorkspace();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const name = locale === "en" ? operator.enName : operator.name;
  const skills = skillTiersOf(operator.name);
  const unlocked = new Set(unlockedSkillNodes(skills, owned));
  const state = selected ? t("当前工位", "Current slot")
    : unavailable ? (unavailableLabel ?? t("已安排至其他工位", "Assigned elsewhere")) : "";
  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger delay={0} aria-describedby={open ? tooltipId : undefined} render={<button type="button" className="ef-manual-choice"
      data-operator-id={operator.id} data-operator-name={operator.name} data-current-selection={selected || undefined}
      aria-label={`${name}${state ? ` · ${state}` : ""}`} aria-pressed={selected} aria-disabled={unavailable || !ready}
      onClick={() => { if (ready && !unavailable) onSelect(); }} /> }>
      <span className="ef-manual-choice-state" aria-hidden="true">{state || "\u00a0"}</span>
      <OperatorPortrait name={operator.id} size={80} showTitle={false} />
      <span className="ef-manual-choice-name" aria-hidden="true">{name}</span>
    </TooltipTrigger>
    <TooltipContent id={tooltipId} role="tooltip" side="top" className="max-w-[calc(100vw-2rem)] flex-col items-start gap-2 whitespace-normal px-3 py-2.5 text-left leading-relaxed sm:max-w-md">
      <strong>{name} · E{owned.elite}{state ? ` · ${state}` : ""}</strong>
      {skills.map(skill => {
        const active = unlocked.has(skill.nodeId);
        return <div key={skill.nodeId} data-skill-unlocked={active} className={active ? "" : "grayscale opacity-70"}>
          <div className="flex items-center gap-2 font-semibold">
            <GameArtwork src={skill.icon} name={skill.name} size={28} />
            <span>{locale === "en" ? skill.enName || skill.name : skill.name}</span>
            <small className="rounded-sm border border-background/20 px-1.5 py-0.5 text-[10px]">E{skill.unlock} · {active ? t("已解锁", "Unlocked") : t("未解锁", "Locked")}</small>
          </div>
          <p className="mt-1 text-background/75">{locale === "en" ? skill.enDescription || skill.description : skill.description}</p>
        </div>;
      })}
    </TooltipContent>
  </Tooltip>;
}
