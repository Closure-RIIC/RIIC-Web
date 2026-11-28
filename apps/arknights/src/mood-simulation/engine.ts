import type Decimal from "decimal.js";
import { ALLOWED_CYCLE_HOURS } from "@riic/arknights-domain/rotation-settings";
import { pointAt, segmentAt } from "./presentation.ts";
export { pointAt, segmentAt } from "./presentation.ts";
import { D, catalog, ledger, occupants, operator, serializeLedger, variables, zero, type Op, type Room, type World } from "./rules.ts";
import type { MoodSimulationInput, MoodSimulationResult, MoodSegment, MoodRate, MoodSeries, MoodSeriesPoint } from "./types.ts";
import { roomCapacity } from "./rooms.ts";
import { resolveFiammettaRule } from "./settings.ts";
import { FIAMMETTA_OPERATOR, MONSTER_CUISINE } from "./constants.ts";
import { applyDormLocks, dormLocksAt, type ManualDormLock } from "../manual-dorm-locks.ts";

const roomTypes: Record<string,string> = {factory:"manufacturing",trade_post:"trading",power_plant:"power",meeting_room:"reception",training_room:"training"};
const minGap = new D("0.000001");
const compareNames = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
export function prepare(input: MoodSimulationInput) {
  const warnings: string[] = [];
  const roster = new Map(input.operbox.filter(o => o.own).map(o => [o.name,o]));
  // Preserve the reference engine's first-assignment order. Decimal event ties
  // can resolve one operator before another at the final precision digit.
  const names = new Set<string>();
  for (const shift of input.draft.shifts) for (const room of input.layout.rooms) for (const name of shift.rooms[room.id]?.operators ?? []) if (name) names.add(name);
  for (const lock of input.draft.dormLocks ?? []) if (lock.operator) names.add(lock.operator);
  // Unassigned, fully rested operators cannot enter the idle-recovery queue.
  // A newer BOX must not abort an otherwise supported schedule.
  for (const name of roster.keys()) if (catalog.knownOperators.includes(name)) names.add(name);
  const ops = new Map([...names].map(name => {
    const e = roster.get(name);
    if (!e) warnings.push(name);
    return [name,operator(name,e?.elite,e?.level)] as const;
  }));
  return {ops,warnings};
}
type SimulationRoom = Room & { slots: (Op | null)[] };
interface SimulationWorld extends World { rooms: SimulationRoom[] }

function worldFor(input: MoodSimulationInput, shift: number, ops: Map<string,Op>, locks: readonly ManualDormLock[]): SimulationWorld {
  const assigned = new Set<string>();
  const planned = applyDormLocks(input.draft.shifts[shift]!, locks);
  const rooms = input.layout.rooms.map(r => {
    const names = planned.rooms[r.id]?.operators ?? [];
    const capacity = roomCapacity(r.kind, r.level, r.dorm_beds);
    if (names.slice(capacity).some(Boolean)) throw new Error(`Room capacity exceeded: ${r.id}`);
    for (const n of names) {
      if (!n) continue;
      if (assigned.has(n)) throw new Error(`Duplicate assignment: ${n}`);
      assigned.add(n);
    }
    const slots = Array.from({length:capacity}, (_, index) => names[index] ? ops.get(names[index]!)! : null);
    return {id:r.id,type:roomTypes[r.kind] ?? r.kind,level:r.level,capacity,slots,ops:slots.filter(op => op !== null)} satisfies SimulationRoom;
  });
  return {rooms,initial:{[MONSTER_CUISINE]:new D(input.layout.scenario.initial_global?.monster_cuisine ?? 0)}};
}
export function simulate(input: MoodSimulationInput): MoodSimulationResult {
  if (!Number.isInteger(input.settings.cycles) || input.settings.cycles < 1 || input.settings.cycles > 7) throw new Error("Invalid cycle count");
  if (!input.draft.shifts.length || input.draft.shifts.some(s => !Number.isFinite(s.durationHours) || s.durationHours <= 0)) throw new Error("Invalid shift duration");
  const cycleHours = input.draft.shifts.reduce((n,s) => n.add(s.durationHours),zero());
  if (!ALLOWED_CYCLE_HOURS.some(hours => cycleHours.sub(hours).abs().lte(minGap))) {
    throw new Error(`Shift durations must total ${ALLOWED_CYCLE_HOURS.join(" / ")} hours`);
  }
  const {ops,warnings} = prepare(input);
  const result: MoodSimulationResult = {
    revision:catalog.revision,names:[...ops.keys()],total:cycleHours.mul(input.settings.cycles).toNumber(),
    points:[],series:[],segments:[],events:[],idleCandidates:[],warnings,cycleEnds:[],
  };
  const lastMood = new Map<string,Decimal>();
  const record = (t: Decimal) => {
    const moods: Record<string,number> = {};
    for (const [name,op] of ops) {
      const previous = lastMood.get(name);
      lastMood.set(name,op.mood);
      // Unchanged full mood is implied by pointAt(); every value below 24 is kept.
      if (op.mood.eq(24) && (previous?.eq(24) ?? true)) continue;
      moods[name]=op.mood.toNumber();
    }
    result.points.push({time:t.toNumber(),moods});
  };
  let t = zero();
  record(t);
  for (let cycle=0;cycle<input.settings.cycles;cycle++) {
    for (let shift=0;shift<input.draft.shifts.length;shift++) {
      const locks = dormLocksAt(input.draft,shift,cycle);
      const w = worldFor(input,shift,ops,locks);
      const {durationHours, fiammettaTarget:targetName} = input.draft.shifts[shift]!;
      const end = t.add(durationHours);
      const rule = resolveFiammettaRule(input.settings.fiammetta[shift], targetName);
      const fiammetta = input.fiammettaEnabled && rule.enabled ? ops.get(FIAMMETTA_OPERATOR) : undefined;
      let swapped = false;
      const swap = () => {
        if (swapped || !fiammetta?.mood.eq(24)) return false;
        swapped = true;
        const dorm = w.rooms.find(room => room.type === "dormitory" && room.slots.includes(fiammetta));
        const previous = dorm ? dorm.slots[dorm.slots.indexOf(fiammetta) - 1] : undefined;
        const lowest = () => occupants(w).filter(other => other !== fiammetta).sort((a,b) => a.mood.cmp(b.mood))[0];
        const target = rule.mode === "specified" ? ops.get(targetName ?? "")
          : rule.mode === "auto" ? lowest() : previous ?? lowest();
        if (!target || target === fiammetta) {
          result.events.push({time:t.toNumber(),kind:"skipped",operator:fiammetta.name,reason:"entry_target_missing",target:targetName ?? undefined});
          return false;
        }
        fiammetta.mood = target.mood;
        target.mood = new D(24);
        result.events.push({time:t.toNumber(),kind:"entry",operator:fiammetta.name,target:target.name});
        record(t);
        return true;
      };
      swap();
      if (input.settings.idleEnabled) applyIdle(w,input,ops,cycle,shift,t,result,locks);
      const segment: MoodSegment = {start:t.toNumber(),end:end.toNumber(),cycle,shift,rooms:Object.fromEntries(w.rooms.map(r => [r.id,r.ops.map(o => o.name)])),
        dormSlots:Object.fromEntries(w.rooms.filter(room => room.type === "dormitory").map(room => [room.id,room.slots.map(op => op?.name ?? null)])),
        lockedDormSlots:Object.fromEntries(w.rooms.filter(room => room.type === "dormitory").map(room => [room.id,locks.filter(lock => lock.roomId === room.id).map(lock => lock.slotIndex)]))};
      result.segments.push(segment);
      // Every segment resets positions, but all operator instances retain their moods.
      let rates: Map<string,Decimal> | null = null;
      let iterations = 0;
      while (t.lt(end)) {
        if (++iterations > 20000) throw new Error("Simulation event limit exceeded");
        if (!rates) {
          const vars = variables(w);
          const present = new Set(occupants(w));
          rates = new Map([...ops].map(([n,o]) => [n,present.has(o) ? ledger(w,o,vars).net : zero()]));
        }
        let next = end, snaps = new Map<string,number>(), snapped = false, snappedToZero = false;
        for (const [name,rate] of rates) {
          if (rate.eq(0)) continue;
          const o=ops.get(name)!;
          for (const h of [0,12,18,20,24]) {
            if (!((rate.gt(0) && o.mood.gt(h)) || (rate.lt(0) && o.mood.lt(h)))) continue;
            const dt=o.mood.sub(h).div(rate);
            if (dt.lt(minGap)) {
              if (!o.mood.eq(h)) {
                o.mood=new D(h);snapped=true;result.points[result.points.length-1]!.moods[name]=h;
                if (h===0) snappedToZero=true;
              }
            } else if (dt.lt(next.sub(t))) {next=t.add(dt);snaps=new Map([[name,h]]);}
            else if (dt.eq(next.sub(t))) snaps.set(name,h);
          }
        }
        if (snappedToZero) {
          // An exhausted occupant loses shared reductions before the next integration step.
          rates=null;
          continue;
        }
        for (const r of w.rooms) for (let i=0;i<r.ops.length;i++) for (let j=i+1;j<r.ops.length;j++) {
          const a=r.ops[i]!,b=r.ops[j]!,dv=rates.get(a.name)!.sub(rates.get(b.name)!);
          if (dv.eq(0)) continue;
          // Matches the reference engine's crossing event convention.
          const dt=b.mood.sub(a.mood).div(dv);
          if (dt.gte(minGap) && dt.lt(next.sub(t))) {next=t.add(dt);snaps.clear();}
        }
        let eventFired=snaps.size>0 || snapped || next.lt(end);
        if (next.sub(t).gt("0.25")) {next=t.add("0.25");snaps.clear();eventFired=snapped;}
        if (next.lte(t)) {next=D.min(end,t.add("0.25"));snaps.clear();eventFired=snapped;}
        const dt=next.sub(t);
        for (const [name,o] of ops) {
          o.mood=D.min(24,D.max(0,o.mood.sub(rates.get(name)!.mul(dt))));
          if (snaps.has(name)) o.mood=new D(snaps.get(name)!);
        }
        t=next; record(t);
        if (swap() || eventFired) rates=null;
      }
    }
    result.cycleEnds.push(Object.fromEntries([...ops].map(([n,o]) => [n,o.mood.toNumber()])));
  }
  result.series=buildSeries(result);
  return result;
}
function buildSeries(result: MoodSimulationResult): MoodSeries[] {
  const groups=new Map<string,MoodSeries>();
  for (const name of result.names) {
    const samples=result.points.map(point => ({time:point.time,mood:point.moods[name] ?? 24}));
    const points: MoodSeriesPoint[]=[samples[0]!];
    for (let index=1;index<samples.length-1;index++) {
      const before=samples[index-1]!, current=samples[index]!, after=samples[index+1]!;
      if (before.time===current.time || current.time===after.time) {
        points.push(current);
        continue;
      }
      const priorSlope=(current.mood-before.mood)/(current.time-before.time);
      const nextSlope=(after.mood-current.mood)/(after.time-current.time);
      if (Math.abs(priorSlope-nextSlope)>1e-9) points.push(current);
    }
    if (samples.length>1) points.push(samples.at(-1)!);
    const key=JSON.stringify(points);
    const group=groups.get(key);
    if (group) group.names.push(name);
    else groups.set(key,{names:[name],points});
  }
  return [...groups.values()];
}
function applyIdle(w: SimulationWorld,input: MoodSimulationInput,ops: Map<string,Op>,cycle: number,shift: number,t: Decimal,result: MoodSimulationResult,locks: readonly ManualDormLock[]) {
  const assigned = new Map(w.rooms.flatMap(room => room.ops.map(op => [op,room] as const)));
  const vacancies = w.rooms.filter(room => room.type === "dormitory").flatMap(room =>
    room.slots.flatMap((op,index) => op || locks.some(lock => lock.roomId === room.id && lock.slotIndex === index)
      ? [] : [{ room,index }]));
  const candidates = [...ops.values()].filter(op => {
    const room = assigned.get(op);
    return op.mood.lt(24) && (!room || room.type === "workshop" || room.type === "training");
  }).sort((a,b) =>
    Number(a.name !== FIAMMETTA_OPERATOR) - Number(b.name !== FIAMMETTA_OPERATOR)
    || a.mood.cmp(b.mood) || compareNames(a.name,b.name));
  let nextSlot = 0;
  for (const op of candidates) {
    result.idleCandidates.push({cycle,shift,operator:op.name,mood:op.mood.toNumber()});
    if (input.settings.idle[`${cycle}:${shift}:${op.name}`]?.enabled === false) continue;
    const vacancy = vacancies[nextSlot++];
    if (!vacancy) {
      result.events.push({time:t.toNumber(),kind:"skipped",operator:op.name,reason:"no_candidate"});
      continue;
    }
    const previous = assigned.get(op);
    if (previous) {
      previous.slots[previous.slots.indexOf(op)] = null;
      previous.ops = previous.slots.filter(item => item !== null);
    }
    const { room,index } = vacancy;
    room.slots[index] = op;
    room.ops = room.slots.filter(item => item !== null);
    result.events.push({time:t.toNumber(),kind:"idle",operator:op.name,room:room.id});
  }
}
export function detailAt(input: MoodSimulationInput,result: MoodSimulationResult,time: number,name: string): MoodRate {
  const {ops}=prepare(input),segment=segmentAt(result,time),moods=pointAt(result,time);
  for (const [n,o] of ops) o.mood=new D(moods[n] ?? 24);
  const w=worldFor(input,segment.shift,ops,dormLocksAt(input.draft,segment.shift,segment.cycle));
  for (const r of w.rooms) r.ops=(segment.rooms[r.id] ?? []).map(n => ops.get(n)!);
  const op=ops.get(name);
  if (!op) throw new Error(`Unknown operator: ${name}`);
  return serializeLedger(ledger(w,op));
}
