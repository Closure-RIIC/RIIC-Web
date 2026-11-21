import type Decimal from "decimal.js";
import { pointAt, segmentAt } from "./presentation.ts";
export { pointAt, segmentAt } from "./presentation.ts";
import { D, catalog, factions, ledger, occupants, operator, serializeLedger, variables, working, zero, type Op, type Room, type World } from "./rules.ts";
import type { MoodSimulationInput, MoodSimulationResult, MoodSegment, MoodRate, MoodEvent, MoodSeries, MoodSeriesPoint } from "./types.ts";
import { roomCapacity } from "./rooms.ts";
import { FIAMMETTA_OPERATOR, FIAMMETTA_SKILL_TEMPLATE, MONSTER_CUISINE } from "./constants.ts";

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
function worldFor(input: MoodSimulationInput, shift: number, ops: Map<string,Op>): World {
  const assigned = new Set<string>();
  const rooms = input.layout.rooms.map(r => {
    const names = input.draft.shifts[shift]?.rooms[r.id]?.operators.filter((n): n is string => Boolean(n)) ?? [];
    const capacity = roomCapacity(r.kind, r.level, r.dorm_beds);
    if (names.length > capacity) throw new Error(`Room capacity exceeded: ${r.id}`);
    for (const n of names) {
      if (assigned.has(n)) throw new Error(`Duplicate assignment: ${n}`);
      assigned.add(n);
    }
    return {id:r.id,type:roomTypes[r.kind] ?? r.kind,level:r.level,capacity,ops:names.map(n => ops.get(n)!)} satisfies Room;
  });
  return {rooms,initial:{[MONSTER_CUISINE]:new D(input.layout.scenario.initial_global?.monster_cuisine ?? 0)}};
}
export function simulate(input: MoodSimulationInput): MoodSimulationResult {
  if (!Number.isInteger(input.settings.cycles) || input.settings.cycles < 1 || input.settings.cycles > 7) throw new Error("Invalid cycle count");
  if (!input.draft.shifts.length || input.draft.shifts.some(s => !Number.isFinite(s.durationHours) || s.durationHours <= 0)) throw new Error("Invalid shift duration");
  const {ops,warnings} = prepare(input);
  const cycleHours = input.draft.shifts.reduce((n,s) => n.add(s.durationHours),zero());
  if (cycleHours.sub(24).abs().gt("0.000001")) throw new Error("Shift durations must total 24 hours");
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
      const w = worldFor(input,shift,ops);
      const end = t.add(input.draft.shifts[shift]!.durationHours);
      const rule = input.settings.fiammetta[shift] ?? {enabled:true,mode:"specified",wait:false};
      const swapped = new Set<string>();
      const entryHolders = () => w.rooms.filter(r => r.type === "dormitory").flatMap(r => r.ops.filter(o => o.skills.some(s => s.template_id === FIAMMETTA_SKILL_TEMPLATE)).map(o => ({o,r})));
      const swap = () => {
        let success = false;
        for (const {o,r} of entryHolders()) {
          if (swapped.has(o.name) || !o.mood.gte(24)) continue;
          const targetName = input.draft.shifts[shift]!.fiammettaTarget;
          const target = rule.mode === "auto" ? occupants(w).filter(other => other !== o).sort((a,b) => a.mood.cmp(b.mood))[0] :
            rule.mode === "previous" || !targetName ? r.ops[r.ops.indexOf(o)-1] : occupants(w).find(other => other !== o && other.name === targetName);
          if (!target) {
            result.events.push({time:t.toNumber(),kind:"skipped",operator:o.name,reason:"entry_target_missing",target:targetName ?? undefined});
            continue;
          }
          const before = o.mood; o.mood = target.mood; target.mood = before;
          swapped.add(o.name); success = true;
          result.events.push({time:t.toNumber(),kind:"entry",operator:o.name,target:target.name});
        }
        if (success) record(t);
        return success;
      };
      let pending = false;
      if (input.fiammettaEnabled && rule.enabled) {
        const success = swap();
        pending = !success && rule.wait && entryHolders().some(({o}) => o.mood.lt(24));
      }
      if (input.settings.idleEnabled) applyIdle(w,input,ops,cycle,shift,t,result);
      const segment: MoodSegment = {start:t.toNumber(),end:end.toNumber(),cycle,shift,rooms:Object.fromEntries(w.rooms.map(r => [r.id,r.ops.map(o => o.name)]))};
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
        let next = end, snaps = new Map<string,number>(), snapped = false;
        for (const [name,rate] of rates) {
          if (rate.eq(0)) continue;
          const o=ops.get(name)!;
          for (const h of [0,12,18,20,24]) {
            if (!((rate.gt(0) && o.mood.gt(h)) || (rate.lt(0) && o.mood.lt(h)))) continue;
            const dt=o.mood.sub(h).div(rate);
            if (dt.lt(minGap)) {
              if (!o.mood.eq(h)) {o.mood=new D(h);snapped=true;result.points[result.points.length-1]!.moods[name]=h;}
            } else if (dt.lt(next.sub(t))) {next=t.add(dt);snaps=new Map([[name,h]]);}
            else if (dt.eq(next.sub(t))) snaps.set(name,h);
          }
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
        if (pending && entryHolders().some(({o}) => o.mood.gte(24))) {pending=false;swap();rates=null;}
        else if (eventFired) rates=null;
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
    const samples=result.points.map(point => [point.time,point.moods[name] ?? 24] as const);
    const points: MoodSeriesPoint[]=[];
    for (const [time,mood] of samples) {
      if (points.length<2) {points.push({time,mood});continue;}
      const previous=points[points.length-1]!, before=points[points.length-2]!;
      const priorSlope=previous.time===before.time ? Infinity : (previous.mood-before.mood)/(previous.time-before.time);
      const nextSlope=time===previous.time ? Infinity : (mood-previous.mood)/(time-previous.time);
      if (!Number.isFinite(priorSlope) || !Number.isFinite(nextSlope) || Math.abs(priorSlope-nextSlope)>1e-9) points.push({time,mood});
    }
    const last=samples.at(-1);
    if (last && points.at(-1)?.time!==last[0]) points.push({time:last[0],mood:last[1]});
    const key=JSON.stringify(points);
    const group=groups.get(key);
    if (group) group.names.push(name);
    else groups.set(key,{names:[name],points});
  }
  return [...groups.values()];
}
function applyIdle(w: World,input: MoodSimulationInput,ops: Map<string,Op>,cycle: number,shift: number,t: Decimal,result: MoodSimulationResult) {
  const dorms=w.rooms.filter(r => r.type === "dormitory"), reverse=[...dorms].reverse();
  const locate=(o: Op) => w.rooms.find(r => r.ops.includes(o));
  const locked=new Set(input.dormLocks ?? []);
  const isLocked=(o: Op) => locked.has(`${cycle}:${shift}:${o.name}`);
  const candidates=[...ops.values()].filter(o => {
    const r=locate(o); return o.mood.lt(24) && (!r || ["workshop","training"].includes(r.type));
  }).sort((a,b) => {
    // Fiammetta recovers in a dorm and powers the next shift's mood swap, so
    // she gets a bed before other idle candidates even at a higher mood.
    const fiammetta=Number(a.name!==FIAMMETTA_OPERATOR)-Number(b.name!==FIAMMETTA_OPERATOR);
    return fiammetta || Number(Boolean(locate(a)))-Number(Boolean(locate(b))) || a.mood.cmp(b.mood) || compareNames(a.name,b.name);
  });
  const removed=new Set<string>();
  for (const o of candidates) {
    result.idleCandidates.push({cycle,shift,operator:o.name,mood:o.mood.toNumber(),room:locate(o)?.id ?? null,
      options:dorms.map(r => ({room:r.id,free:r.ops.length<r.capacity,operators:r.ops.map(p => ({name:p.name,mood:p.mood.toNumber()}))}))});
    const rule=input.settings.idle[`${cycle}:${shift}:${o.name}`];
    if (rule?.enabled === false) continue;
    const skipped=(reason: MoodEvent["reason"],target?: string) => result.events.push({time:t.toNumber(),kind:"skipped",operator:o.name,target,reason});
    let dorm=rule?.dorm ? dorms.find(r => r.id === rule.dorm && r.ops.length<r.capacity) : reverse.find(r => r.ops.length<r.capacity);
    if (rule?.dorm && !dorm) {skipped("dorm_unavailable",rule.dorm);continue;}
    let mate: Op | undefined;
    if (!dorm) {
      const memo=new Map<string,boolean>();
      const vars=variables(w), before=new Map(occupants(w).map(p => [p.name,ledger(w,p,vars).net]));
      const pendant=(p: Op) => {
        if (memo.has(p.name)) return memo.get(p.name)!;
        const probe={...w,rooms:w.rooms.map(r => ({...r,ops:r.ops.filter(q => q !== p)}))};
        const probeVars=variables(probe);
        const bad=occupants(probe).some(q => ledger(probe,q,probeVars).net.gt(before.get(q.name)!));
        memo.set(p.name,bad);return bad;
      };
      const workFactions=new Set(w.rooms.filter(working).flatMap(r => r.ops.flatMap(factions)));
      const protectedFaction=(p: Op) => factions(p).some(f => workFactions.has(f));
      const pickable=(p: Op) => !removed.has(p.name) && !isLocked(p) && p.mood.gte(24) && !pendant(p);
      for (const r of dorms.slice(1,4).reverse()) {
        mate=r.ops.slice(1,5).find(pickable); if (mate) {dorm=r;break;}
      }
      if (!mate) for (const r of reverse) {
        mate=[...r.ops.slice(1,5),...r.ops.slice(0,1)].find(p => (p.name === FIAMMETTA_OPERATOR || !protectedFaction(p)) && pickable(p));
        if (mate) {dorm=r;break;}
      }
      if (!mate && rule?.target) {
        for (const r of reverse) {mate=r.ops.find(p => p.name === rule.target && !removed.has(p.name) && !isLocked(p));if (mate) {dorm=r;break;}}
      }
      // Automatic admission may only replace a full-mood operator. An underfull
      // dorm mate is still recovering, so evicting it would make the shift worse.
      if (!mate || !dorm) {skipped("no_candidate",rule?.target);continue;}
      if (mate.mood.lte(o.mood)) {skipped("target_not_higher",mate.name);continue;}
    }
    const previous=locate(o);
    if (previous) previous.ops=previous.ops.filter(p => p !== o);
    if (mate) {dorm!.ops[dorm!.ops.indexOf(mate)]=o;removed.add(mate.name);}
    else dorm!.ops.push(o);
    result.events.push({time:t.toNumber(),kind:"idle",operator:o.name,target:mate?.name,room:dorm!.id});
  }
}
export function detailAt(input: MoodSimulationInput,result: MoodSimulationResult,time: number,name: string): MoodRate {
  const {ops}=prepare(input),segment=segmentAt(result,time),moods=pointAt(result,time);
  for (const [n,o] of ops) o.mood=new D(moods[n] ?? 24);
  const w=worldFor(input,segment.shift,ops);
  for (const r of w.rooms) r.ops=(segment.rooms[r.id] ?? []).map(n => ops.get(n)!);
  const op=ops.get(name);
  if (!op) throw new Error(`Unknown operator: ${name}`);
  return serializeLedger(ledger(w,op));
}
