import { OperatorPortrait } from "../components/GameArtwork";
import { useWorkspace } from "../state";
import type { OperatorState } from "./use-simulation.ts";

const STATUS_LABEL = { work: "工作中", rest: "休息中", zero: "已归零" } as const;
const STATUS_LABEL_EN = { work: "Working", rest: "Resting", zero: "Depleted" } as const;

/**
 * 当前时刻的干员状态：头像 + 姓名 + 心情 + 工作状态。
 * 拖动时间轴即可查看任意时刻谁在上班。
 */
export function OperatorStates({ states }: { states: OperatorState[] }) {
  const { t, locale } = useWorkspace();
  if (!states.length) return <p className="ef-muted ef-mood-empty">{t("暂无数据", "No data")}</p>;
  return <ul className="ef-mood-people">
    {states.map(state => <li key={state.name} data-status={state.status}>
      <OperatorPortrait name={state.name} size={32} showTitle={false} />
      <div className="ef-mood-person">
        <b>{locale === "en" ? state.name : state.name}</b>
        <small className="ef-muted">{state.room}</small>
      </div>
      <span className="ef-mood-person-mood">{state.mood.toFixed(0)}%</span>
      <span className="ef-mood-person-status">
        <i aria-hidden />{locale === "en" ? STATUS_LABEL_EN[state.status] : STATUS_LABEL[state.status]}
      </span>
    </li>)}
  </ul>;
}
