import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { StepRoom, StepView } from "../step/step-types.ts";
import { formatClock } from "../step/step-engine.ts";
import { useWorkspace } from "../state";

const W = 640;
const H = 240;
const PAD_L = 44;
const PAD_R = 56;
const PAD_T = 12;
const PAD_B = 24;
const PW = W - PAD_L - PAD_R;
const PH = H - PAD_T - PAD_B;

const PRODUCT_COLORS: Record<string, string> = {
  晶植: "var(--ef-step-growth)", 菌类: "var(--ef-step-rate)", 矿物: "var(--ef-step-mineral)", 干员经验: "var(--ef-step-growth)", 武器经验: "var(--ef-step-rate)", 线索: "var(--ef-step-rate)",
};

function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) & 0xffffff;
  return `hsl(${hash % 360} 60% var(--ef-step-series-lightness))`;
}

function buildStepPolyline(samples: StepView["history"], valueOf: (index: number) => number | null, xs: (t: number) => number, ys: (value: number) => number): string {
  const points: string[] = [];
  let previous: number | null = null;
  for (let index = 0; index < samples.length; index += 1) {
    const value = valueOf(index);
    if (value == null || !Number.isFinite(value)) continue;
    const x = xs(samples[index].tSec);
    const y = ys(value);
    if (previous === null) points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    else {
      points.push(`${x.toFixed(1)},${previous.toFixed(1)}`);
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    previous = y;
  }
  return points.join(" ");
}

function nearestSample(times: number[], tSec: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] < tSec) low = middle + 1; else high = middle;
  }
  if (low > 0 && Math.abs(times[low - 1] - tSec) < Math.abs(times[low] - tSec)) return low - 1;
  return low;
}

function Chart({ room, view }: { room: StepRoom; view: StepView }) {
  const { t } = useWorkspace();
  const [hover, setHover] = useState<{ left: number; top: number; index: number } | null>(null);
  const operators = view.ops.filter(op => op.roomKey === room.key);
  const samples = view.history;
  const isCentral = room.key === "中枢";
  const isGrowth = room.key === "培养舱";
  const products = room.products;

  let rateMax = 0;
  for (const sample of samples) {
    const rates = sample.rates[room.key];
    if (!rates) continue;
    for (const value of Object.values(rates)) if (value > rateMax) rateMax = value;
  }
  rateMax *= 1.15;
  rateMax = isCentral ? Math.max(10, Math.ceil(rateMax)) : Math.max(1, Math.ceil(rateMax * 10) / 10);

  const xs = (t: number) => PAD_L + (view.maxTSec > 0 ? t / view.maxTSec : 0) * PW;
  const ysMood = (value: number) => PAD_T + PH - (value / 100) * PH;
  const ysRate = (value: number) => PAD_T + PH - (value / rateMax) * PH;
  const hours = view.maxTSec / 3600;
  const gridStep = hours > 36 ? 12 : hours > 16 ? 6 : 3;
  const times = samples.map(sample => sample.tSec);

  function move(event: ReactMouseEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || !samples.length) return;
    const rect = svg.getBoundingClientRect();
    const svgX = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * W : 0;
    const inner = svgX - PAD_L;
    if (inner < 0 || inner > PW) { setHover(null); return; }
    const tSec = (inner / PW) * view.maxTSec;
    const index = nearestSample(times, tSec);
    let left = event.clientX + 14;
    let top = event.clientY + 14;
    if (left + 280 > window.innerWidth) left = event.clientX - 280;
    if (top + 180 > window.innerHeight) top = event.clientY - 180;
    setHover({ left, top, index });
  }

  const sample = hover ? samples[hover.index] : null;
  const hoverX = hover && sample ? xs(sample.tSec) : null;

  return <div className="mood-chart-card" data-room={room.key}>
    <div className="mood-chart-title">{room.label}</div>
    <div className="mood-chart-svg">
      <svg viewBox={`0 0 ${W} ${H}`} data-room={room.key} role="img" aria-label={`${room.label} ${t("心情与产率曲线", "morale and production chart")}`}>
        {Array.from({ length: Math.floor(hours / gridStep) + 1 }, (_, index) => index * gridStep).map(hour => {
          const x = xs(hour * 3600);
          return <g key={`h${hour}`}>
            <line className="chart-grid" x1={x} y1={PAD_T} x2={x} y2={PAD_T + PH} />
            <text className="chart-label" x={x} y={H - 6} textAnchor="middle">{hour}h</text>
          </g>;
        })}
        {[0, 25, 50, 75, 100].map(value => {
          const y = ysMood(value);
          return <g key={`m${value}`}>
            <line className="chart-grid" x1={PAD_L} y1={y} x2={PAD_L + PW} y2={y} />
            <text className="chart-label" x={PAD_L - 4} y={y + 3} textAnchor="end">{value}%</text>
          </g>;
        })}
        {Array.from({ length: 5 }, (_, index) => {
          const value = (rateMax / 4) * index;
          const y = ysRate(value);
          return <text key={`r${index}`} className="chart-label chart-label-rate" x={PAD_L + PW + 4} y={y + 3} textAnchor="start">
            {isCentral ? value.toFixed(0) : value.toFixed(1)}
          </text>;
        })}
        <text className="chart-label chart-label-rate" x={W - 4} y={PAD_T + 8} textAnchor="end">
          {isCentral ? "%" : t("产率", "Rate")}
        </text>
        {view.log.map((entry, index) => {
          if (entry.room !== room.key) return null;
          if (entry.type !== "switch" && entry.type !== "boost") return null;
          const x = xs(entry.tSec);
          return <line key={`e${index}`} x1={x} y1={PAD_T} x2={x} y2={PAD_T + PH}
            stroke={entry.type === "boost" ? "var(--ef-step-rate)" : "var(--ef-ink)"} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />;
        })}
        {operators.map(operator => {
          const points = samples.map(item => {
            const mood = item.moods[operator.name];
            return mood === undefined ? "" : `${xs(item.tSec).toFixed(1)},${ysMood(mood).toFixed(1)}`;
          }).filter(Boolean).join(" ");
          return points.includes(",") ? <polyline key={operator.name} points={points} fill="none" stroke={colorForName(operator.name)}
            strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" /> : null;
        })}
        {isGrowth
          ? products.map(product => {
            const points = buildStepPolyline(samples, index => samples[index].rates[room.key]?.[product] ?? null, xs, ysRate);
            return points ? <polyline key={product} points={points} fill="none" stroke={PRODUCT_COLORS[product] ?? "var(--ef-step-rate)"}
              strokeWidth="2" strokeLinejoin="miter" strokeLinecap="butt" /> : null;
          })
          : (() => {
            const points = buildStepPolyline(samples, index => samples[index].rates[room.key]?._total ?? null, xs, ysRate);
            return points ? <polyline points={points} fill="none" stroke="var(--ef-step-rate)" strokeWidth="2" strokeLinejoin="miter" strokeLinecap="butt" /> : null;
          })()}
        <line x1={xs(view.tSec)} y1={PAD_T} x2={xs(view.tSec)} y2={PAD_T + PH} stroke="var(--ef-ink)" strokeWidth="1.5" />
        {hoverX != null ? <line className="chart-hover-line" x1={hoverX} y1={PAD_T} x2={hoverX} y2={PAD_T + PH} stroke="var(--ef-ink)" strokeWidth="1" opacity="0.5" style={{ pointerEvents: "none" }} /> : null}
        <rect className="chart-hover-area" x={PAD_L} y={PAD_T} width={PW} height={PH} fill="transparent" style={{ cursor: "crosshair" }}
          onMouseMove={move} onMouseLeave={() => setHover(null)} />
      </svg>
    </div>
    <div className="mood-chart-legend">
      {operators.map(operator => <span className="legend-item" key={operator.name}>
        <span className="legend-dot" style={{ background: colorForName(operator.name) }} />{operator.name}
      </span>)}
      {isGrowth
        ? products.map(product => <span className="legend-item" key={product}>
          <span className="legend-line-rate" style={{ background: PRODUCT_COLORS[product] ?? "var(--ef-step-rate)", height: 2, width: 16, display: "inline-block" }} />{product} {t("产率", "rate")}
        </span>)
        : <span className="legend-item">
          <span className="legend-line-rate total" style={{ height: 2, width: 16, display: "inline-block", background: "var(--ef-step-rate)" }} />{isCentral ? t("恢复加成", "Recovery bonus") : t("产率", "Rate")}
        </span>}
    </div>
    {hover && sample ? <div className="chart-tooltip" style={{ display: "block", left: hover.left, top: hover.top }}>
      <div className="chart-tooltip-title">{formatClock(sample.tSec, view.startHour)}</div>
      {isGrowth
        ? products.map(product => {
          const value = sample.rates[room.key]?.[product] ?? 0;
          return <div className="chart-tooltip-row" key={product}>
            <span className="label" style={{ color: PRODUCT_COLORS[product] ?? "var(--ef-step-rate)" }}>{product}</span>
            <span className="val chart-tooltip-rate">{value.toFixed(2)}</span>
          </div>;
        })
        : <div className="chart-tooltip-row">
          <span className="label">{isCentral ? t("恢复加成", "Recovery bonus") : t("产率", "Rate")}</span>
          <span className="val chart-tooltip-rate">
            {isCentral ? `+${(sample.rates[room.key]?._total ?? 0).toFixed(0)}%` : (sample.rates[room.key]?._total ?? 0).toFixed(2)}
          </span>
        </div>}
      <div className="chart-tooltip-operators">
        {operators.map(operator => {
          const mood = sample.moods[operator.name];
          if (mood === undefined) return null;
          const activeRound = sample.activeRounds[room.key];
          const working = sample.workings[operator.name];
          const status = operator.round === activeRound ? (working ? t("工作", "Working") : t("休息", "Resting")) : t("待命", "Standby");
          return <div className="chart-tooltip-row" key={operator.name}>
            <span className="label">{operator.name}{operator.round === "round2" ? "Ⅱ" : ""} · {status}</span>
            <span className="val">{mood.toFixed(1)}%</span>
          </div>;
        })}
      </div>
    </div> : null}
  </div>;
}

/** ② 各舱心情曲线与产率。 */
export function StepCharts({ view, rooms }: { view: StepView; rooms: StepRoom[] }) {
  const { t } = useWorkspace();
  if (!view.ops.length || !view.history.length) {
    return <div className="ef-empty" id="moodCharts"><p>{t("配置排班后开始模拟。", "Assign operators and start the simulation.")}</p></div>;
  }
  const visible = rooms.filter(room => view.ops.some(op => op.roomKey === room.key));
  return <div className="mood-charts-grid" id="moodCharts">
    {visible.map(room => <Chart key={room.key} room={room} view={view} />)}
  </div>;
}
