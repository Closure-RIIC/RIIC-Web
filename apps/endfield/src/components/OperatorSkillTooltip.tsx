import { useId, useState, type ReactNode } from "react";
import { catalog, type Operator } from "@riic/endfield-solver/model.mjs";
import { operatorData } from "@riic/endfield-data";
import { unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@riic/ui-primitives/tooltip";
import { useWorkspace } from "../state";
import { GameArtwork } from "./GameArtwork";

export type SkillTooltipOperator = (typeof catalog)[number];

/** 找出名单里的干员；不在名单里（例如技能 wiki 页）返回 undefined。 */
function ownedEntry(operators: Operator[], name: string) {
  return operators.find(item => item.name === name);
}

/** 干员当前生效的技能档位：解锁要求以展示数据为准。 */
export function operatorSkillTiers(operator: SkillTooltipOperator) {
  const display = operatorData(operator.id);
  return operator.skills.map(skill => {
    const source = display?.skills.find(item => item.id === skill.nodeId) ?? display?.skills.find(item => item.name === skill.name);
    return { ...skill, source, unlock: source?.unlock ?? skill.unlock };
  });
}

/**
 * 干员头像的悬浮技能说明：名字 · 精英化 · 每个技能的解锁状态与描述。
 *
 * 三处共用（手动排班、排班结果、我的干员弹窗），内容只看名单里的精英化与已解锁节点，
 * 不需要额外的状态文案。技能 wiki 页不启用。
 */
export function OperatorSkillTooltip({ name, children, side = "top" }: {
  name: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const { workspace, locale, t } = useWorkspace();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const operator = catalog.find(item => item.name === name);
  const display = operator ? operatorData(operator.id) : operatorData(name);
  const entry = ownedEntry(workspace.operators, name);
  const label = (locale === "en" ? display?.enName : display?.name) || name;

  if (!operator) return <>{children}</>;

  const skills = operatorSkillTiers(operator);
  const unlocked = entry ? new Set(unlockedSkillNodes(skills, entry)) : null;

  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger delay={0} aria-describedby={open ? tooltipId : undefined} render={<span className="ef-skill-tooltip-anchor" />}>
      {children}
    </TooltipTrigger>
    <TooltipContent id={tooltipId} role="tooltip" side={side}
      className="max-w-[calc(100vw-2rem)] flex-col items-start gap-2 whitespace-normal px-3 py-2.5 text-left leading-relaxed sm:max-w-md">
      <strong>{label}{entry ? ` · E${entry.elite}` : ""}</strong>
      {skills.map(skill => {
        const active = unlocked === null ? null : !!skill.nodeId && unlocked.has(skill.nodeId);
        return <div key={skill.nodeId ?? skill.name}
          data-skill-unlocked={active === null ? undefined : active}
          className={active === false ? "grayscale opacity-70" : undefined}>
          <div className="flex items-center gap-2 font-semibold">
            <GameArtwork src={skill.source?.icon} name={skill.name} size={28} />
            <span>{locale === "en" ? skill.source?.enName || skill.name : skill.name}</span>
            <small className="rounded-sm border border-background/20 px-1.5 py-0.5 text-[10px]">
              E{skill.unlock}{active === null ? "" : ` · ${active ? t("已解锁", "Unlocked") : t("未解锁", "Locked")}`}
            </small>
          </div>
          <p className="mt-1 text-background/75">{locale === "en" ? skill.source?.enDescription || skill.description : skill.description}</p>
        </div>;
      })}
    </TooltipContent>
  </Tooltip>;
}
