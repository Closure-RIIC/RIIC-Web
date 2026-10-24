import { OperatorPortrait } from "../components/GameArtwork";
import { ScrollArea } from "@riic/ui-primitives/scroll-area";
import { operatorData } from "@riic/endfield-data";
import { useWorkspace } from "../state";
import type { OperatorState } from "./presentation.ts";

const STATUS_LABEL = { work: "工作中", rest: "休息中", standby: "待命", zero: "已归零" } as const;
const STATUS_LABEL_EN = { work: "Working", rest: "Resting", standby: "Standby", zero: "Depleted" } as const;

/**
 * 当前时刻的干员状态：头像 + 姓名 + 心情 + 工作状态。
 * 拖动时间轴即可查看任意时刻谁在上班。
 */
export function OperatorStates({ states, selected, onSelect }: { states: OperatorState[]; selected: string; onSelect: (name: string) => void }) {
  const { t, locale } = useWorkspace();
  if (!states.length) return <p className="ef-muted ef-mood-empty">{t("暂无数据", "No data")}</p>;
  return <ScrollArea className="ef-step-operator-scroll" viewportProps={{ "aria-label": t("模拟干员", "Simulated operators") }}><ul className="ef-mood-people">
    {states.map(state => <li key={state.name}><button type="button" data-status={state.status} data-step-operator={state.name}
      className="ef-mood-operator" aria-pressed={selected === state.name} onClick={() => onSelect(state.name)}>
      <OperatorPortrait name={state.name} size={32} showTitle={false} />
      <div className="ef-mood-person">
        <b>{locale === "en" ? operatorData(state.name)?.enName || state.name : state.name}</b>
      </div>
      <span className="ef-mood-person-mood">{state.mood.toFixed(0)}%</span>
      <span className="ef-mood-person-status">
        <i aria-hidden />{locale === "en" ? STATUS_LABEL_EN[state.status] : STATUS_LABEL[state.status]}
      </span>
    </button></li>)}
  </ul></ScrollArea>;
}
