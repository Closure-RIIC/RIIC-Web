import { operatorName } from "../i18n/game-data";
import { OperatorPortrait } from "../components/GameArtwork";
import { ScrollArea } from "@riic/ui-primitives/scroll-area";
import { Check } from "lucide-react";
import { useWorkspace } from "../state";
import type { OperatorState } from "./presentation.ts";


/**
 * 当前时刻的干员状态：头像 + 姓名 + 心情 + 工作状态。
 * 拖动时间轴即可查看任意时刻谁在上班。
 */
export function OperatorStates({ states, selected, onSelect }: { states: OperatorState[]; selected: ReadonlySet<string> | null; onSelect: (name: string) => void }) {
  const { t, locale } = useWorkspace();
  if (!states.length) return <p className="ef-muted ef-mood-empty">{t("operatorStates.noData")}</p>;
  return <ScrollArea className="ef-step-operator-scroll" viewportProps={{ role: "group", "aria-label": t("operatorStates.selectMoraleCurveOperators") }}><ul className="ef-mood-people">
    {states.map(state => <li key={state.name}><button type="button" data-status={state.status} data-step-operator={state.name}
      className="ef-mood-operator" aria-pressed={selected === null || selected.has(state.name)} onClick={() => onSelect(state.name)}
      aria-label={t("operatorStates.moraleCurve", { name: operatorName(state.name, locale) })}>
      <span className="ef-mood-avatar"><OperatorPortrait name={state.name} size={32} showTitle={false} />
        <Check className="ef-mood-selection" aria-hidden />
      </span>
      <div className="ef-mood-person">
        <b>{operatorName(state.name, locale)}</b>
      </div>
      <span className="ef-mood-person-mood">{state.mood.toFixed(0)}%</span>
      <span className="ef-mood-person-status">
        <i aria-hidden />{t(`operatorStates.status.${state.status}`)}
      </span>
    </button></li>)}
  </ul></ScrollArea>;
}
