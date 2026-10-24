import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis, usePlotArea } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@riic/ui-primitives/chart";
import { Input } from "@riic/ui-primitives/input";
import { Tabs, CompactTabsList, TabsTrigger } from "@riic/ui-primitives/tabs";
import { Action } from "@riic/endfield-ui";
import { operatorData } from "@riic/endfield-data";
import type { StepRoom, StepView } from "../step/step-types.ts";
import { formatClock } from "../step/step-engine.ts";
import { useWorkspace } from "../state";
import { OperatorStates } from "./operator-states";
import { operatorsAt } from "./presentation";

/** PR #603 的按舱室双图结构，共用明日方舟的图表基础组件。 */
export function MoodCharts({ view, timeline, rooms, onSeek }: {
  view: StepView; timeline: StepView; rooms: StepRoom[]; onSeek: (seconds: number) => void;
}) {
  const { locale, t } = useWorkspace();
  const [roomKey, setRoomKey] = useState("");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const occupied = rooms.filter(room => view.ops.some(op => op.roomKey === room.key));
  const room = occupied.find(room => room.key === roomKey) ?? occupied[0];
  if (!room) return <p className="ef-muted">{t("请先安排干员。", "Assign operators first.")}</p>;
  const states = operatorsAt(view, room.key);
  const focus = states.some(op => op.name === selected) ? selected : "";
  const labelOf = (name: string) => locale === "en" ? operatorData(name)?.enName || name : name;
  const visible = states.filter(op => `${op.name} ${labelOf(op.name)}`.toLowerCase().includes(query.toLowerCase()));
  return <div id="moodCharts" className="ef-mood-workbench">
    <Tabs value={room.key} onValueChange={value => { setRoomKey(String(value)); setSelected(""); setQuery(""); }}>
      <CompactTabsList aria-label={t("模拟舱室", "Simulated facility")}>
        {occupied.map(item => <TabsTrigger key={item.key} value={item.key}>{roomLabel(item, t)}</TabsTrigger>)}
      </CompactTabsList>
    </Tabs>
    <div className="ef-step-inspector">
      <div className="ef-step-operator-list">
        <Input aria-label={t("搜索模拟干员", "Search simulated operators")} placeholder={t("搜索干员", "Search operators")}
          value={query} onChange={event => setQuery(event.target.value)} />
        <Action size="sm" aria-pressed={!focus} onClick={() => setSelected("")}>{t("全部干员曲线", "All operator curves")}</Action>
        <OperatorStates states={visible} selected={focus} onSelect={setSelected} />
      </div>
      <div className="ef-step-detail" data-step-detail={focus || "all"}>
        <div className="ef-mood-room-panel">
          <figure className="ef-mood-card"><figcaption>{focus ? labelOf(focus) : roomLabel(room, t)} · {t("心情", "Morale")}</figcaption>
            <RoomMoodChart timeline={timeline} room={room} cursor={view.tSec} selected={focus} onSeek={onSeek} />
          </figure>
          <figure className="ef-mood-card"><figcaption>{roomLabel(room, t)} · {t("产率", "Rate")}</figcaption>
            <RoomRateChart timeline={timeline} room={room} cursor={view.tSec} onSeek={onSeek} />
          </figure>
        </div>
        <p className="ef-muted ef-step-chart-summary">{t("心情为 0–100%；产率为等效小时 / 小时，中枢显示恢复加成。", "Morale ranges from 0–100%. Production uses effective hours per hour; the center shows recovery bonus.")}</p>
        <p className="ef-muted ef-step-chart-summary">{t("虚线标记换班与助力；点击曲线或拖动时间轴查看当时状态。", "Dashed lines mark shift changes and assists. Click a chart or drag the timeline to inspect a moment.")}</p>
      </div>
    </div>
  </div>;
}

type ChartProps = { timeline: StepView; room: StepRoom; cursor: number; onSeek: (seconds: number) => void };

/** 名字决定颜色，切换舱室或增删干员时保持稳定；亮度跟随主题。 */
export function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) & 0xffff;
  return `hsl(${hash % 360} 52% var(--ef-step-series-lightness))`;
}

export function RoomMoodChart({ timeline, room, cursor, selected, onSeek }: ChartProps & { selected: string }) {
  const { locale, t } = useWorkspace();
  const { rows, names } = useMoodSeries(timeline, room.key, selected);
  const config: ChartConfig = Object.fromEntries(names.map((name, index) => [`op${index}`, {
    label: locale === "en" ? operatorData(name)?.enName || name : name, color: colorForName(name),
  }]));
  const values = selected ? rows.map(row => row.op0).filter(Number.isFinite) : [];
  return <>
    <RoomChart {...{ timeline, room, cursor, onSeek, rows, config }} mood />
    {values.length ? <p className="ef-muted ef-step-chart-summary">{t(`最低 ${Math.min(...values).toFixed(1)}% · 最高 ${Math.max(...values).toFixed(1)}% · 结束 ${values.at(-1)!.toFixed(1)}%`,
      `Minimum ${Math.min(...values).toFixed(1)}% · Maximum ${Math.max(...values).toFixed(1)}% · Final ${values.at(-1)!.toFixed(1)}%`)}</p> : null}
  </>;
}

function useMoodSeries(timeline: StepView, roomKey: string, selected: string) {
  return useMemo(() => {
    const names = timeline.ops.filter(op => op.roomKey === roomKey && (!selected || op.name === selected)).map(op => op.name);
    const rows: Record<string, number>[] = timeline.history.map(point => ({ time: point.tSec, ...Object.fromEntries(names.map((name, index) => [`op${index}`, point.moods[name]])) }));
    return { rows, names };
  }, [timeline, roomKey, selected]);
}

export function RoomRateChart({ timeline, room, cursor, onSeek }: ChartProps) {
  const { t } = useWorkspace();
  const { rows, keys } = useRateSeries(timeline, room.key, room.products);
  const config: ChartConfig = Object.fromEntries(keys.map((product, index) => [`rate${index}`, {
    label: product === "_total" ? t("中枢恢复加成", "Central recovery bonus") : productLabel(product, t),
    color: ["var(--ef-step-growth)", "var(--ef-step-rate)", "var(--ef-step-mineral)"][index % 3],
  }]));
  return <RoomChart {...{ timeline, room, cursor, onSeek, rows, config }} mood={false} />;
}

function useRateSeries(timeline: StepView, roomKey: string, products: string[]) {
  return useMemo(() => {
    const keys = roomKey === "中枢" ? ["_total"] : products;
    const rows = timeline.history.map(point => ({ time: point.tSec,
      ...Object.fromEntries(keys.map((product, index) => [`rate${index}`, point.rates[roomKey]?.[product] ?? point.rates[roomKey]?._total ?? 0])),
    }));
    return { rows, keys };
  }, [timeline, roomKey, products]);
}

function RoomChart({ timeline, room, cursor, onSeek, rows, config, mood }: ChartProps & {
  rows: Record<string, number>[]; config: ChartConfig; mood: boolean;
}) {
  const clock = (seconds: number) => formatClock(seconds, timeline.startHour).replace(/:00(?= \(|$)/, "");
  return <ChartContainer className="ef-step-chart" config={config}>
    <LineChart accessibilityLayer data={rows} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
      <CartesianGrid vertical={false} strokeDasharray="3 4" />
      <XAxis dataKey="time" type="number" domain={[0, timeline.maxTSec]} tickFormatter={clock} minTickGap={50} axisLine={false} tickLine={false} tickMargin={10} />
      <YAxis domain={mood ? [0, 100] : [0, "auto"]} ticks={mood ? [0, 25, 50, 75, 100] : undefined} width={36} axisLine={false} tickLine={false} tickMargin={8} />
      <ChartTooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} content={<ChartTooltipContent indicator="line"
        labelFormatter={(_label, payload) => clock(Number(payload[0]?.payload.time ?? 0))}
        formatter={(value, key) => <><span className="ef-muted">{config[String(key)]?.label}</span><span>{Number(value).toFixed(1)}{mood || room.key === "中枢" ? "%" : "/h"}</span></>} />} />
      <ChartLegend content={<ChartLegendContent />} />
      {mood ? <ReferenceArea y1={0} y2={30} fill="var(--destructive)" fillOpacity={0.06} /> : null}
      {timeline.log.filter(event => event.room === room.key && (event.type === "switch" || event.type === "boost")).map((event, index) =>
        <ReferenceLine key={index} x={event.tSec} stroke={event.type === "boost" ? "var(--ef-step-rate)" : "var(--border)"} strokeDasharray="3 3" />)}
      {Object.keys(config).map(key => <Line key={key} type={mood ? "linear" : "stepAfter"} dataKey={key}
        stroke={`var(--color-${key})`} strokeWidth={2} dot={false} isAnimationActive={false} />)}
      <ReferenceLine x={cursor} stroke="var(--foreground)" strokeWidth={1.5} />
      <SeekArea max={timeline.maxTSec} onSeek={onSeek} />
    </LineChart>
  </ChartContainer>;
}

function SeekArea({ max, onSeek }: { max: number; onSeek: (seconds: number) => void }) {
  const area = usePlotArea();
  if (!area) return null;
  return <rect data-step-chart-seek x={area.x} y={area.y} width={area.width} height={area.height} fill="transparent" style={{ cursor: "crosshair" }}
    onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width) onSeek(Math.round(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * max / 60) * 60);
    }} />;
}

function roomLabel(room: StepRoom, t: (zh: string, en: string) => string) {
  return t(room.label, ({ 中枢: "Control center", 会客室: "Reception", 制造舱1: "Manufacturing I", 制造舱2: "Manufacturing II", 培养舱: "Growth chamber" })[room.key]);
}
function productLabel(product: string, t: (zh: string, en: string) => string) {
  return t(product, ({ 干员经验: "Operator EXP", 武器经验: "Weapon EXP", 线索: "Clues", 晶植: "Crystals", 菌类: "Fungi", 矿物: "Minerals" } as Record<string, string>)[product] ?? product);
}
