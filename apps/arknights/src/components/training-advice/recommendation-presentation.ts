import { localize } from "../../i18n/helpers/components_RecommendationCard.ts";
import type { OperBoxEntry, UserProfileAction } from "../../types.ts";
import { legacyTrainingTarget } from "./skill-selection.ts";

function eliteLabel(elite: number | undefined, en: boolean): string | undefined {
  if (elite !== 0 && elite !== 1 && elite !== 2) return undefined;
  return localize.text(en, "eliteStage", { elite: String(elite) });
}

export function recommendationMessage(action: UserProfileAction, en = false): string {
  const target = legacyTrainingTarget(action.tier_up_requirement)
    ?? legacyTrainingTarget(action.message.match(/tier_up\s*[（(]需([^（）()]+)[）)]/i)?.[1]);
  const targetLabel = eliteLabel(target?.elite, en);
  // Only rewrite the solver's promotion phrase; keep the combination explanation.
  const message = targetLabel
    ? action.message.replace(/升至\s*tier_up(?:\s*[（(]需[^（）()]+[）)])?/gi, () => localize.text(en, "promoteTo", { target: targetLabel }))
    : action.message;
  return message
    .replace(/\btier_up\b/gi, () => targetLabel ?? localize.text(en, "promotionTarget"))
    .replace(/现([1-6])★精([012])\s*(\d+)级/g, (_match, rarity: string, elite: string, level: string) => (
      localize.text(en, "currentProgress", { rarity, elite: eliteLabel(Number(elite), en)!, level })
    ));
}

export function recommendationCurrentState(action: UserProfileAction, entry?: OperBoxEntry, en = false): string {
  if (entry && !entry.own) return localize.text(en, "notOwned");
  const current = eliteLabel(action.current_elite ?? entry?.elite, en);
  const target = eliteLabel(legacyTrainingTarget(action.tier_up_requirement)?.elite, en);
  if (current && target) return localize.text(en, "currentAndTarget", { current, target });
  if (current) return localize.text(en, "currentStage", { current });
  return localize.text(en, "progressUnknown");
}
