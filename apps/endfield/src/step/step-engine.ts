import type {
  RoomEffectResolver, SimOp, SimOptions, SimRates, SimRoomState, StepConfig, StepEventType, StepLogEntry, StepRoomKey, StepRound, StepSample, StepView,
} from "./step-types.ts";

const EPS = 1e-6;
const MAX_SAMPLES = 20000;
const MAX_LOG = 2000;

interface SimBoost {
  tSec: number;
  target: string;
  triggered: boolean;
}

const roundName = (round: StepRound) => round === "round1" ? "一轮" : "二轮";

export function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours === 0 && minutes === 0) return `${rest}s`;
  if (hours === 0) return `${minutes}m${rest}s`;
  if (minutes === 0 && rest === 0) return `${hours}h`;
  if (rest === 0) return `${hours}h${minutes}m`;
  return `${hours}h${minutes}m${rest}s`;
}

export function formatClock(tSec: number, startHour: number): string {
  const total = Math.max(0, startHour) * 3600 + Math.max(0, tSec);
  const day = Math.floor(total / 86400);
  const hour = Math.floor((total % 86400) / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = Math.floor(total % 60);
  const base = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return day > 0 ? `${base} (+${day}d)` : base;
}

function normalizeHour(value: number): number {
  return ((Math.round(value) % 24) + 24) % 24;
}

/**
 * 事件驱动模拟内核（从 endfield-simulated/step.js v11 移植）。
 *
 * 保留原有的速率与公式：工作 7.2%/h、休息 12%/h、助力 +30%、产率
 * `(1 + Σ效率/100) × (1 + 0.4N)`。数据全部来自构造参数，不读 DOM、不读存储。
 */
export class StepSimulation {
  private readonly config: StepConfig;
  private readonly resolver: RoomEffectResolver;
  private readonly rates: SimRates;
  private readonly startHour: number;
  private readonly maxTSec: number;
  private readonly sampleSec: number;

  private tSec = 0;
  private ops: SimOp[] = [];
  private rooms: Record<string, SimRoomState> = {};
  private output: StepView["output"] = {};
  private workTimeSec: Record<string, number> = {};
  private history: StepSample[] = [];
  private log: StepLogEntry[] = [];
  private lastMood: Record<string, "zero" | "full" | null> = {};
  private nextSampleSec = 0;
  private ended = false;
  private boosts: SimBoost[] = [];

  /** 求解器速率是 0–1 的小数（0.072 = 7.2%），心情用 0–100 的百分点。 */
  private get workPerSec(): number { return this.rates.work * 100 / 3600; }
  private get restPerSec(): number { return this.rates.rest * 100 / 3600; }
  private get assistPoints(): number { return this.rates.assist * 100; }

  constructor(config: StepConfig, resolver: RoomEffectResolver, rates: SimRates, options: SimOptions) {
    this.config = config;
    this.resolver = resolver;
    this.rates = rates;
    this.startHour = normalizeHour(options.startHour);
    this.maxTSec = Math.max(1, Math.round(options.maxHours * 3600));
    this.sampleSec = Math.max(1, Math.round(options.sampleSec));
    this.build();
  }

  private build(): void {
    this.tSec = 0;
    this.ops = [];
    this.rooms = {};
    this.output = {};
    this.workTimeSec = {};
    this.history = [];
    this.log = [];
    this.lastMood = {};
    this.ended = false;
    this.boosts = this.buildBoosts();

    const seen = new Set<string>();
    for (const room of this.config.rooms) {
      if (!room.enabled) continue;
      const hour = Math.min(23, Math.max(1, Math.round(room.hour)));
      const shiftEnabled = !room.single && room.crewB.some(Boolean);
      const activeRound: StepRound = shiftEnabled && this.startHour >= hour ? "round2" : "round1";
      this.rooms[room.key] = {
        activeRound,
        shiftEnabled,
        shiftABSec: hour * 3600,
        shiftBASec: (24 - hour) * 3600,
        nextSwitchAtSec: shiftEnabled ? this.nextSwitchAt(hour) : null,
      };
      this.output[room.key] = room.key === "培养舱"
        ? Object.fromEntries(room.products.map(product => [product, 0]))
        : 0;
      this.workTimeSec[room.key] = 0;

      const rounds: [StepRound, (string | null)[]][] = shiftEnabled
        ? [["round1", room.crewA], ["round2", room.crewB]]
        : [["round1", room.crewA]];
      for (const [round, crew] of rounds) {
        for (const name of crew) {
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const effects = this.resolver(name, room.key);
          const mood = Math.min(100, Math.max(0, this.config.moods[name] ?? 100));
          const wantWork = this.config.work[name] !== false && mood > 0;
          const active = round === activeRound;
          this.ops.push({
            name, roomKey: room.key, round, mood,
            working: active && wantWork, wantWork,
            reduce: effects.reduce, restore: effects.restore, effMap: { ...effects.effMap },
          });
          this.lastMood[name] = mood <= 0 ? "zero" : mood >= 100 ? "full" : null;
        }
      }
    }

    this.logEvent("start", `▶ 模拟开始（事件驱动 · 精度 1s）：起点 ${String(this.startHour).padStart(2, "0")}:00，时长 ${formatDuration(this.maxTSec)}，采样 ${this.sampleSec}s`);
    for (const room of this.config.rooms) {
      const state = this.rooms[room.key];
      if (!state) continue;
      const shift = state.shiftEnabled ? `（一轮 ${state.shiftABSec / 3600}h，二轮 ${state.shiftBASec / 3600}h）` : "（不轮班）";
      const first = this.ops.filter(op => op.roomKey === room.key && op.round === "round1").map(op => op.name);
      this.logEvent("start", `   ${room.label}${shift} 一轮：${first.join(" / ") || "空"}`, room.key);
      if (state.shiftEnabled) {
        const second = this.ops.filter(op => op.roomKey === room.key && op.round === "round2").map(op => op.name);
        this.logEvent("start", `   ${room.label} 二轮：${second.join(" / ") || "空"}`, room.key);
      }
    }
    this.recordSampleAt(0);
    this.nextSampleSec = this.sampleSec;
  }

  /**
   * 距离下一次换班的秒数。班次按自然日锚定：A=[0, hour)，B=[hour, 24)。
   * 起点在 B 班时，B 结束于 24:00（不是第二天的 hour）。
   */
  private nextSwitchAt(hour: number): number {
    return this.startHour >= hour ? (24 - this.startHour) * 3600 : (hour - this.startHour) * 3600;
  }

  private buildBoosts(): SimBoost[] {
    const boosts: SimBoost[] = [];
    if (this.config.boost.dailyCount <= 0) return boosts;
    const absoluteStart = this.startHour * 3600;
    const absoluteEnd = absoluteStart + this.maxTSec;
    const firstDay = Math.floor(absoluteStart / 86400) * 86400;
    for (let day = 0; day < 5; day += 1) {
      const dayStart = firstDay + day * 86400;
      if (dayStart > absoluteEnd) break;
      const config = this.config.boost.days[day] ?? this.config.boost.days[this.config.boost.days.length - 1];
      if (!config) continue;
      for (const entry of config.list.slice(0, this.config.boost.dailyCount)) {
        if (!entry.target) continue;
        const absolute = dayStart + entry.hour * 3600 + entry.minute * 60;
        if (absolute < absoluteStart || absolute > absoluteEnd) continue;
        boosts.push({ tSec: absolute - absoluteStart, target: entry.target, triggered: false });
      }
    }
    return boosts.sort((a, b) => a.tSec - b.tSec);
  }

  private logEvent(type: StepEventType, text: string, room?: StepRoomKey): void {
    this.log.push({ type, tSec: this.tSec, text, room });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  private roomConfig(key: string) {
    return this.config.rooms.find(room => room.key === key);
  }

  private roomLabel(key: string): string {
    return this.roomConfig(key)?.label ?? key;
  }

  /** 当前中枢在岗干员提供的“全员心情恢复”总和（%）。 */
  centralBonus(): number {
    const room = this.rooms["中枢"];
    if (!room) return 0;
    let sum = 0;
    for (const op of this.ops) {
      if (op.roomKey !== "中枢" || op.round !== room.activeRound) continue;
      if (op.mood <= EPS || !op.wantWork) continue;
      sum += op.restore;
    }
    return sum;
  }

  /** 当前舱室在岗干员提供的“心情消耗减少”总和（%）。 */
  roomReduce(key: string): number {
    const room = this.rooms[key];
    if (!room) return 0;
    let sum = 0;
    for (const op of this.ops) {
      if (op.roomKey !== key || op.round !== room.activeRound || !op.working) continue;
      sum += op.reduce;
    }
    return sum;
  }

  /** 单类产率；`product` 省略时把该舱所有追踪产物的效率相加（旧页口径）。 */
  rateFor(key: string, product?: string): number {
    const room = this.rooms[key];
    if (!room) return 0;
    const products = this.roomConfig(key)?.products ?? [];
    let efficiency = 0;
    let working = 0;
    for (const op of this.ops) {
      if (op.roomKey !== key || op.round !== room.activeRound) continue;
      if (op.mood <= EPS || !op.wantWork) continue;
      working += 1;
      if (product) efficiency += op.effMap[product] ?? 0;
      else for (const item of products) efficiency += op.effMap[item] ?? 0;
    }
    if (!working) return 0;
    return (1 + efficiency / 100) * (1 + this.rates.head * working);
  }

  /** 图表与实时面板使用的产率快照：中枢返回恢复值，培养舱按产物分组。 */
  roomRates(key: string): Record<string, number> {
    const room = this.rooms[key];
    if (!room) return {};
    if (key === "中枢") return { _total: this.centralBonus() };
    const products = this.roomConfig(key)?.products ?? [];
    if (key === "培养舱") {
      const rates: Record<string, number> = {};
      for (const product of products) rates[product] = this.rateFor(key, product);
      return rates;
    }
    return { _total: this.rateFor(key) };
  }

  private nextMoodEventSec(op: SimOp, centralBonus: number): number {
    if (op.working && op.mood > 0) {
      const reduce = this.roomReduce(op.roomKey);
      const speed = this.workPerSec * (1 - reduce / 100);
      return speed <= 0 ? Infinity : this.tSec + op.mood / speed;
    }
    if (!op.working && op.mood < 100) {
      const speed = this.restPerSec * (1 + centralBonus / 100);
      return speed <= 0 ? Infinity : this.tSec + (100 - op.mood) / speed;
    }
    return Infinity;
  }

  private findNextEventSec(): number {
    let next = this.maxTSec;
    for (const room of Object.values(this.rooms)) {
      if (room.shiftEnabled && room.nextSwitchAtSec != null) next = Math.min(next, room.nextSwitchAtSec);
    }
    for (const boost of this.boosts) {
      if (!boost.triggered && boost.tSec >= this.tSec) next = Math.min(next, boost.tSec);
    }
    const centralBonus = this.centralBonus();
    for (const op of this.ops) next = Math.min(next, this.nextMoodEventSec(op, centralBonus));
    if (this.nextSampleSec < next) next = this.nextSampleSec;
    return next;
  }

  private advanceTo(tSec: number): void {
    const delta = tSec - this.tSec;
    if (delta <= 0) return;
    const centralBonus = this.centralBonus();
    const reduces: Record<string, number> = {};
    for (const key of Object.keys(this.rooms)) reduces[key] = this.roomReduce(key);

    for (const op of this.ops) {
      if (op.working) {
        const speed = this.workPerSec * (1 - (reduces[op.roomKey] ?? 0) / 100);
        op.mood = Math.max(0, op.mood - speed * delta);
      } else {
        const speed = this.restPerSec * (1 + centralBonus / 100);
        op.mood = Math.min(100, op.mood + speed * delta);
      }
    }

    for (const key of Object.keys(this.rooms)) {
      if (key === "中枢") continue;
      const room = this.rooms[key];
      const hasWorker = this.ops.some(op => op.roomKey === key && op.round === room.activeRound && op.working);
      if (!hasWorker) continue;
      if (key === "培养舱") {
        const output = this.output[key] as Record<string, number>;
        for (const product of this.roomConfig(key)?.products ?? []) {
          output[product] = (output[product] ?? 0) + this.rateFor(key, product) * (delta / 3600);
        }
      } else {
        this.output[key] = (this.output[key] as number) + this.rateFor(key) * (delta / 3600);
      }
      this.workTimeSec[key] += delta;
    }
    this.tSec = tSec;
  }

  private processEventsAt(tSec: number): void {
    let extraSample = false;

    for (const boost of this.boosts) {
      if (boost.triggered || Math.abs(boost.tSec - tSec) >= EPS) continue;
      boost.triggered = true;
      const op = this.ops.find(item => item.name === boost.target);
      if (!op) continue;
      const before = op.mood;
      op.mood = Math.min(100, op.mood + this.assistPoints);
      this.logEvent("boost", `⚡ 助力：${op.name}（${this.roomLabel(op.roomKey)}）心情 +${Math.round(this.assistPoints)}（${before.toFixed(1)}% → ${op.mood.toFixed(1)}%）`, op.roomKey);
      extraSample = true;
    }

    for (const op of this.ops) {
      if (op.working && op.mood <= EPS) {
        op.mood = 0; op.working = false; op.wantWork = false; extraSample = true;
      } else if (!op.working && op.mood >= 100 - EPS) {
        op.mood = 100; op.wantWork = true;
        const room = this.rooms[op.roomKey];
        if (room && op.round === room.activeRound) { op.working = true; extraSample = true; }
      }
    }

    for (const op of this.ops) {
      const last = this.lastMood[op.name] ?? null;
      if (op.mood <= EPS && last !== "zero") {
        this.logEvent("mood-zero", `💤 ${op.name}（${this.roomLabel(op.roomKey)}）心情归零`, op.roomKey);
        this.lastMood[op.name] = "zero";
      } else if (op.mood >= 100 - EPS && last !== "full") {
        this.logEvent("mood-full", `☀️ ${op.name}（${this.roomLabel(op.roomKey)}）心情回满`, op.roomKey);
        this.lastMood[op.name] = "full";
      } else if (op.mood > EPS && op.mood < 100 - EPS && last) {
        this.lastMood[op.name] = null;
      }
    }

    for (const [key, room] of Object.entries(this.rooms)) {
      if (!room.shiftEnabled || room.nextSwitchAtSec == null) continue;
      if (tSec < room.nextSwitchAtSec - EPS) continue;
      const from = room.activeRound;
      const to: StepRound = from === "round1" ? "round2" : "round1";
      room.activeRound = to;
      for (const op of this.ops) {
        if (op.roomKey !== key) continue;
        if (op.round === to && op.mood > 0) { op.wantWork = true; op.working = true; }
        else op.working = false;
      }
      this.logEvent("switch", `🔄 ${this.roomLabel(key)} ${roundName(from)} → ${roundName(to)}`, key as StepRoomKey);
      room.nextSwitchAtSec = tSec + (to === "round2" ? room.shiftBASec : room.shiftABSec);
      extraSample = true;
    }

    if (tSec >= this.nextSampleSec - EPS) {
      this.recordSampleAt(tSec);
      this.nextSampleSec += this.sampleSec;
    } else if (extraSample) {
      this.recordSampleAt(tSec);
    }
  }

  private recordSampleAt(tSec: number): void {
    const moods: Record<string, number> = {};
    const workings: Record<string, boolean> = {};
    for (const op of this.ops) { moods[op.name] = op.mood; workings[op.name] = op.working; }
    const rates: Record<string, Record<string, number>> = {};
    const activeRounds: Record<string, StepRound> = {};
    for (const key of Object.keys(this.rooms)) {
      rates[key] = this.roomRates(key);
      activeRounds[key] = this.rooms[key].activeRound;
    }
    this.history.push({ tSec, moods, workings, rates, activeRounds });
    if (this.history.length > MAX_SAMPLES) this.history.shift();
  }

  private checkEnd(): boolean {
    if (this.ended) return true;
    if (this.tSec >= this.maxTSec - EPS) {
      if (this.nextSampleSec <= this.maxTSec) this.recordSampleAt(this.maxTSec);
      this.tSec = this.maxTSec;
      this.logEvent("end", "✅ 模拟结束");
      this.ended = true;
      return true;
    }
    return false;
  }

  /** 推进到下一个事件点；结束返回 false。 */
  nextEvent(): boolean {
    if (this.ended) return false;
    if (this.checkEnd()) return false;
    let next = Math.ceil(this.findNextEventSec() - EPS);
    if (next > this.maxTSec) next = this.maxTSec;
    if (next <= this.tSec) next = this.tSec + 1;
    this.advanceTo(next);
    this.processEventsAt(next);
    this.checkEnd();
    return !this.ended;
  }

  /** 一次跑完；步数上限防止异常数据造成死循环。 */
  runToEnd(limit = 5_000_000): void {
    let steps = 0;
    while (!this.ended && this.tSec < this.maxTSec && steps < limit) {
      if (!this.nextEvent()) break;
      steps += 1;
    }
    if (!this.ended && this.tSec < this.maxTSec) {
      this.advanceTo(this.maxTSec);
      this.processEventsAt(this.maxTSec);
    }
    this.checkEnd();
  }

  markPaused(): void {
    if (!this.ended) this.logEvent("pause", "⏸ 已暂停");
  }

  clearLog(): void {
    this.log = [];
  }

  get view(): StepView {
    return {
      tSec: this.tSec, maxTSec: this.maxTSec, startHour: this.startHour, ended: this.ended,
      ops: this.ops, rooms: this.rooms, output: this.output, workTimeSec: this.workTimeSec,
      history: this.history, log: this.log,
    };
  }
}
