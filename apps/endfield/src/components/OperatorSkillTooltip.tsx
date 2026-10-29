import { displayText } from "../i18n/game-data";
import { useId, useState, type ReactNode } from "react";
import type { Operator } from "@riic/endfield-solver/model.mjs";
import { operatorData, skillTiersOf } from "@riic/endfield-data";
import { unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@riic/ui-primitives/tooltip";
import { useWorkspace } from "../state";
import { GameArtwork } from "./GameArtwork";

/** 找出名单里的干员；不在名单里（例如技能 wiki 页）返回 undefined。 */
function ownedEntry(operators: Operator[], name: string) {
  return operators.find(item => item.name === name);
}

/**
 * 干员头像的悬浮技能说明：名字 · 精英化 · 每个技能的解锁状态与描述。
 *
 * 三处共用（手动排班、排班结果、我的干员弹窗），内容只看名单里的精英化与已解锁节点，
 * 不需要额外的状态文案。技能 wiki 页不启用。
 *
 * 未拥有的干员：标题补「未拥有」，所有技能按未解锁显示。
 */
export function OperatorSkillTooltip({ name, children, side = "top" }: {
  name: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const { workspace, locale, t } = useWorkspace();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const display = operatorData(name);
  const entry = ownedEntry(workspace.operators, name);
  const label = (displayText(display, "name", locale)) || name;

  if (!display) return <>{children}</>;

  const skills = skillTiersOf(display.name);
  const unlocked = entry ? new Set(unlockedSkillNodes(skills, entry)) : null;
  const heading = `${label}${entry ? ` · E${entry.elite}` : ` · ${t("OperatorSkillTooltip.notOwned")}`}`;

  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger delay={0} aria-describedby={open ? tooltipId : undefined} render={<span className="ef-skill-tooltip-anchor" />}>
      {children}
    </TooltipTrigger>
    <TooltipContent id={tooltipId} role="tooltip" side={side}
      className="max-w-[calc(100vw-2rem)] flex-col items-start gap-2 whitespace-normal px-3 py-2.5 text-left leading-relaxed sm:max-w-md">
      <strong>{heading}</strong>
      {skills.map(skill => {
        const active = !!unlocked?.has(skill.nodeId);
        return <div key={skill.nodeId}
          data-skill-unlocked={active}
          className={active ? undefined : "grayscale opacity-70"}>
          <div className="flex items-center gap-2 font-semibold">
            <GameArtwork src={skill.icon} name={skill.name} size={28} />
            <span>{displayText(skill, "name", locale)}</span>
            <small className="rounded-sm border border-background/20 px-1.5 py-0.5 text-[10px]">
              E{skill.unlock} · {active ? t("OperatorSkillTooltip.unlocked") : t("OperatorSkillTooltip.locked")}
            </small>
          </div>
          <p className="mt-1 text-background/75">{displayText(skill, "description", locale)}</p>
        </div>;
      })}
    </TooltipContent>
  </Tooltip>;
}
