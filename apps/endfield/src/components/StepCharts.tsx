import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis, usePlotArea } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@riic/ui-primitives/chart";
import { Input } from "@riic/ui-primitives/input";
import { ScrollArea } from "@riic/ui-primitives/scroll-area";
import { Tabs, CompactTabsList, TabsTrigger } from "@riic/ui-primitives/tabs";
import { operatorData } from "@riic/endfield-data";
import type { StepRoom, StepView } from "../step/step-types.ts";
import { formatClock } from "../step/step-engine.ts";
import { useWorkspace } from "../state";

/** 与明日方舟心情模拟共用图表容器、提示和图例；数据仍来自终末地引擎。 */
export function StepCharts({ view, timeline, rooms, onSeek }: {
  view: StepView; timeline: StepView; rooms: StepRoom[]; onSeek: (seconds: number) => void;
}) {
  const { locale, t } = useWorkspace();
  const [selection, setSelection] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("mood");
  const selected = view.ops.find(op => op.name === selection) ?? view.ops[0];
  const room = rooms.find(room => room.key === selected?.roomKey);
  const labelOf = (name: string) => locale === "en" ? operatorData(name)?.enName || name : name;
  const name = selected?.name ?? "";
  const products = room?.key === "中枢" ? ["_total"] : room?.products ?? [];
  const chart = useChartData(timeline.history, name, room?.key, room?.products);
  const moods = chart.map(point => point.mood).filter(Number.isFinite);
  const minimum = moods.length ? Math.min(...moods) : 0;
  const maximum = moods.length ? Math.max(...moods) : 0;
  const config: ChartConfig = mode === "mood" ? {
    mood: { label: t("心情", "Morale"), theme: { light: "oklch(0.58 0.14 166)", dark: "oklch(0.72 0.13 166)" } },
  } : Object.fromEntries(products.map((product, index) => [`rate${index}`, {
    label: product === "_total" ? t("中枢恢复加成", "Central recovery bonus") : labelOfProduct(product, t),
    color: ["var(--ef-step-growth)", "var(--ef-step-rate)", "var(--ef-step-mineral)"][index % 3],
  }]));
  const clock = (seconds: number) => formatClock(seconds, view.startHour).replace(/:00(?= \(|$)/, "");
  const visible = view.ops.filter(op => `${op.name} ${labelOf(op.name)}`.toLowerCase().includes(query.toLowerCase()));
  if (!selected || !room) return <p className="ef-muted">{t("请先安排干员。", "Assign operators first.")}</p>;
  const state = view.rooms[room.key];
  const active = selected.round === state?.activeRound;
  const status = active ? selected.working ? t("工作", "Working") : t("休息", "Resting") : t("待命", "Standby");
  return <div className="ef-step-inspector" id="moodCharts">
    <div className="ef-step-operator-list">
      <Input aria-label={t("搜索模拟干员", "Search simulated operators")} placeholder={t("搜索干员", "Search operators")}
        value={query} onChange={event => setQuery(event.target.value)} />
      <ScrollArea className="ef-step-operator-scroll" viewportClassName="ef-step-operator-options" role="group" aria-label={t("模拟干员", "Simulated operators")}>
        {visible.map(op => <button key={op.name} type="button" aria-pressed={name === op.name} data-step-operator={op.name}
          onClick={() => setSelection(op.name)}><span>{labelOf(op.name)}</span><span data-low={op.mood <= 30 || undefined}>{op.mood.toFixed(1)}%</span></button>)}
        {!visible.length ? <p className="ef-muted">{t("没有匹配干员", "No matching operators")}</p> : null}
      </ScrollArea>
    </div>
    <div className="ef-step-detail" data-step-detail={name}>
      <div className="ef-step-detail-heading"><h3>{labelOf(name)} <strong>{selected.mood.toFixed(1)}</strong><span className="ef-muted"> / 100%</span></h3>
        <span className="ef-muted">{room.label} · {selected.round === "round1" ? "A" : "B"} · {status}</span></div>
      <Tabs value={mode} onValueChange={value => setMode(String(value))}>
        <CompactTabsList aria-label={t("曲线类型", "Chart type")}>
          <TabsTrigger value="mood">{t("心情曲线", "Morale curve")}</TabsTrigger>
          <TabsTrigger value="rate">{t("设施产率", "Facility rate")}</TabsTrigger>
        </CompactTabsList>
      </Tabs>
      <ChartContainer className="ef-step-chart" config={config}>
        <LineChart accessibilityLayer data={chart} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="time" type="number" domain={[0, timeline.maxTSec]} tickFormatter={clock} minTickGap={50} axisLine={false} tickLine={false} tickMargin={10} />
          <YAxis domain={mode === "mood" ? [0, 100] : [0, "auto"]} ticks={mode === "mood" ? [0, 25, 50, 75, 100] : undefined}
            width={36} axisLine={false} tickLine={false} tickMargin={8} />
          <ChartTooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} content={<ChartTooltipContent indicator="line"
            labelFormatter={(_label, payload) => clock(Number(payload[0]?.payload.time ?? 0))}
            formatter={(value, key) => <><span className="ef-muted">{config[String(key)]?.label}</span><span>{Number(value).toFixed(1)}{mode === "mood" || room.key === "中枢" ? "%" : "/h"}</span></>} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {mode === "mood" ? <ReferenceArea y1={0} y2={30} fill="var(--destructive)" fillOpacity={0.06} /> : null}
          {timeline.log.filter(event => event.room === room.key && (event.type === "switch" || event.type === "boost")).map((event, index) =>
            <ReferenceLine key={index} x={event.tSec} stroke={event.type === "boost" ? "var(--ef-step-rate)" : "var(--border)"} strokeDasharray="3 3" />)}
          {Object.keys(config).map(key => <Line key={key} type={mode === "mood" ? "linear" : "stepAfter"} dataKey={key}
            stroke={`var(--color-${key})`} strokeWidth={2} dot={false} isAnimationActive={false} />)}
          <ReferenceLine x={view.tSec} stroke="var(--foreground)" strokeWidth={1.5} />
          <SeekArea max={timeline.maxTSec} onSeek={onSeek} />
        </LineChart>
      </ChartContainer>
      <p className="ef-muted ef-step-chart-summary">{mode === "mood"
        ? t(`全程最低 ${minimum.toFixed(1)}% · 最高 ${maximum.toFixed(1)}% · 结束 ${(moods.at(-1) ?? 0).toFixed(1)}%`, `Minimum ${minimum.toFixed(1)}% · Maximum ${maximum.toFixed(1)}% · Final ${(moods.at(-1) ?? 0).toFixed(1)}%`)
        : t("产率单位为等效小时 / 小时；中枢显示恢复加成。", "Rates use effective hours per hour; the control center shows recovery bonus.")}</p>
      <p className="ef-muted ef-step-chart-summary">{t("虚线标记换班与助力；点击曲线或拖动时间轴查看当时状态。", "Dashed lines mark shift changes and assists. Click the chart or drag the timeline to inspect a moment.")}</p>
    </div>
  </div>;
}

function useChartData(history: StepView["history"], name: string, roomKey: string | undefined, products: string[] | undefined) {
  return useMemo(() => {
    const rates = roomKey === "中枢" ? ["_total"] : products ?? [];
    return history.map(point => ({ time: point.tSec, mood: point.moods[name],
      ...Object.fromEntries(rates.map((product, index) => [`rate${index}`, roomKey ? point.rates[roomKey]?.[product] ?? point.rates[roomKey]?._total ?? 0 : 0])),
    }));
  }, [history, name, roomKey, products]);
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

function labelOfProduct(product: string, t: (zh: string, en: string) => string): string {
  return t(product, ({ 干员经验: "Operator EXP", 武器经验: "Weapon EXP", 线索: "Clues", 晶植: "Crystals", 菌类: "Fungi", 矿物: "Minerals" } as Record<string, string>)[product] ?? product);
}
