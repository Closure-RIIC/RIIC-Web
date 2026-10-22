// Port of Rhodes-MoodSOC 5204c840: rules, conditions, variables and ledger.
import Decimal from "decimal.js";
import raw from "./catalog.json" with { type: "json" };
import type { MoodRate } from "./types.ts";
import { moodCatalogAdditions } from "./catalog-additions.ts";

export const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export const zero = () => new D(0);
export interface Skill {
  id: string; name: string; kind: string; value: string; facility_types: string[];
  target_faction: string | null; condition: { name: string; args: (string | string[])[] } | null;
  exclusive: boolean; pool: boolean; untranslated: boolean; count_faction: string | null;
  template_id: string; max_group: string | null; spread_whitelist: boolean;
  var_name: string | null; var_per: string | null; var_min: string | null; basis: string | null;
  self_only: boolean; boost_provider: string | null; boost_group: string | null;
}
interface Equip { unlock_elite: number; unlock_level: number; replaces: string | null }
const referenceCatalog = raw as unknown as {
  revision: string; skills: Record<string, Skill>; equips: Record<string, Record<string, Equip>>;
  operators: Record<string, string[]>; factions: Record<string, string[]>;
  producers: [string, number, string, string, string, string, string, [string, number, number][]][];
  spread: string[]; knownOperators: string[];
};
const additions = moodCatalogAdditions(referenceCatalog.skills);
export const catalog: typeof referenceCatalog = {
  ...referenceCatalog,
  skills: { ...referenceCatalog.skills, ...additions.skills },
  operators: { ...referenceCatalog.operators, ...additions.operators },
  equips: { ...referenceCatalog.equips, ...additions.equips },
  knownOperators: [...new Set([...referenceCatalog.knownOperators, ...Object.keys(additions.operators)])],
};
export interface Op { name: string; elite: number; level: number; mood: Decimal; skills: Skill[] }
export interface Room { id: string; type: string; level: number; capacity: number; ops: Op[] }
export interface World { rooms: Room[]; initial: Record<string, Decimal> }
export const baseId = (id: string) => id.split("#")[0]!;
export const factions = (op: Op) => catalog.factions[op.name] ?? [];
export const occupants = (w: World) => w.rooms.flatMap(r => r.ops);
export const working = (r: Room) => !["dormitory", "workshop", "training"].includes(r.type);
export const workplace = ["power", "manufacturing", "trading", "office", "reception"];
export function operator(name: string, elite = 2, level = 30): Op {
  if (!catalog.knownOperators.includes(name)) throw new Error(`Unknown operator: ${name}`);
  const unlocked = (catalog.operators[name] ?? []).filter(id => {
    const e = catalog.equips[name]?.[id];
    return !catalog.skills[id]!.untranslated && (!e || (elite >= e.unlock_elite && level >= e.unlock_level));
  });
  const replaced = new Set(unlocked.map(id => catalog.equips[name]?.[id]?.replaces).filter(Boolean).map(id => baseId(id!)));
  return { name, elite, level, mood: new D(24), skills: unlocked.filter(id => !replaced.has(baseId(id))).map(id => catalog.skills[id]!) };
}
const skills = (o: Op, kind: string) => o.mood.gt(0) ? o.skills.filter(s => s.kind === kind) : [];
const cc = (w: World) => w.rooms.find(r => r.type === "control_center");
const countFaction = (ops: Op[], f: string) => ops.filter(o => factions(o).includes(f)).length;
export function basis(w: World, key: string | null, room?: Room, op?: Op): Decimal {
  switch (key) {
    case "dorm_operator": return new D(w.rooms.filter(r => r.type === "dormitory").reduce((n,r) => n+r.ops.length,0));
    case "recruit_slot": return new D(w.rooms.find(r => r.type === "office")?.level ?? 0);
    case "sui_non_dorm": return new D(Math.min(5,countFaction(w.rooms.filter(r => r.type !== "dormitory").flatMap(r => r.ops),"岁")));
    case "abyssal_non_dorm": return new D(countFaction(w.rooms.filter(r => r.type !== "dormitory").flatMap(r => r.ops),"深海猎人"));
    case "power_count": return new D(w.rooms.filter(r => r.type === "power").length);
    case "dorm_level": return new D(room?.level ?? 0);
    case "dorm_unfull": return new D(room?.ops.filter(o => o.mood.lt(24)).length ?? 0);
    case "dorm_others": return new D(room?.ops.filter(o => o !== op).length ?? 0);
    default: return new D(1);
  }
}
export function variables(w: World): Record<string, Decimal> {
  const out = { ...w.initial }, byName = new Map(occupants(w).map(o => [o.name,o]));
  for (const [,,name,value,count,condition,,holders] of catalog.producers) {
    for (const [who,elite,level] of holders) {
      const op = byName.get(who);
      if (!op || op.elite < elite || op.level < level || op.mood.lte(0)) continue;
      if (condition === "mood_below_12" && !op.mood.lt(12)) continue;
      if (condition === "mood_above_12" && !op.mood.gt(12)) continue;
      out[name] = (out[name] ?? zero()).add(new D(value).mul(basis(w,count)));
    }
  }
  return out;
}
function condition(s: Skill, w: World, owner: Op, target: Op, room: Room): boolean {
  if (!s.condition) return true;
  const {name,args} = s.condition, arg = args[0] as string, list = args[0] as string[];
  const center = cc(w)?.ops ?? [];
  switch (name) {
    case "_cond_mood_below_18": return target.mood.lt(18);
    case "_cond_mood_below_20": return target.mood.lt(20);
    case "_cond_with_cc_mogui": return center.some(o => o.name === "魔王");
    case "_cond_with_cc_xiangzi": return center.some(o => o.name === "丰川祥子");
    case "_cond_with_cc_operator": return center.some(o => o.name === arg);
    case "_cond_with_cc_faction": return center.some(o => o !== owner && factions(o).includes(arg));
    case "_cond_with_facility_operator": return room.ops.some(o => o.name === arg);
    case "_cond_with_other_operator": return room.ops.some(o => o !== owner);
    case "_cond_alone_in_facility": return room.ops.length === 1 && room.ops[0] === owner;
    case "_cond_target_in_faction": return list.some(f => factions(target).includes(f));
    case "_cond_target_is": return list.includes(target.name);
    case "_cond_self_full_mood": return owner.mood.gte(24);
    case "_cond_no_abyssal_outside_dorm": return basis(w,"abyssal_non_dorm").eq(0);
    case "_cond_dorm_abyssals_full_mood": {
      const dormOps = w.rooms.filter(r => r.type === "dormitory").flatMap(r => r.ops).filter(o => o !== owner && factions(o).includes("深海猎人"));
      return basis(w,"abyssal_non_dorm").eq(0) && dormOps.length > 0 && dormOps.every(o => o.mood.gte(24));
    }
    default: throw new Error(`Unsupported condition: ${name}`);
  }
}
function scaled(s: Skill,w: World,room: Room,op: Op,vars: Record<string, Decimal>): Decimal | null {
  let value = new D(s.value);
  if (s.var_name) {
    const v = vars[s.var_name] ?? zero();
    if (s.var_min !== null && v.lt(s.var_min)) return null;
    if (s.var_per !== null) value = value.mul(v.div(s.var_per).floor());
  }
  if (s.basis) value = value.mul(basis(w,s.basis,room,op));
  return value;
}
interface Entry {
  side: "consume" | "recover"; group: string; label: string; value: Decimal;
  owner?: string; skill?: string; aggregation?: string; applied: boolean;
}
export interface Ledger { consume: Decimal; recover: Decimal; net: Decimal; entries: Entry[] }
export function ledger(w: World,op: Op,vars = variables(w)): Ledger {
  const room = w.rooms.find(r => r.ops.includes(op));
  const entries: Entry[] = [];
  const add = (side: Entry["side"],group: string,value: Decimal,owner?: Op,s?: Skill,aggregation?: string) => {
    entries.push({side,group,label:s?.name ?? group,value,owner:owner?.name,skill:s?.id,aggregation,applied:true});
  };
  const emit = (side: Entry["side"],group: string,owner: Op,s: Skill,aggregation?: string) => {
    if (!room || !condition(s,w,owner,op,room)) return;
    const value = scaled(s,w,room,op,vars);
    if (value !== null) add(side,group,value,owner,s,aggregation);
  };
  const scope = (s: Skill) => room && (!s.facility_types.length || s.facility_types.includes(room.type)) &&
    (!s.target_faction || factions(op).includes(s.target_faction));
  const center = cc(w);
  if (room && room.type !== "dormitory") {
    add("consume","base",new D(working(room) ? 1 : 0));
    if (["manufacturing","trading"].includes(room.type)) add("consume","facility_reduction",new D(-Math.min(Math.max(0,room.ops.length-1)*5,10)).div(100));
    if (center) add("consume","cc_reduction",new D(-Math.min(center.ops.length,5)).mul("0.05"));
    for (const s of skills(op,"self_consume")) if (scope(s)) emit("consume","self_consume",op,s);
    for (const owner of room.ops) {
      for (const s of skills(owner,"facility_consume")) if (scope(s)) emit("consume","facility_consume",owner,s);
      if (owner !== op) for (const s of skills(owner,"room_others_consume")) if (scope(s) && condition(s,w,owner,op,room)) add("consume","facility_consume",new D(s.value),owner,s);
    }
    let best = zero(), bestOwner: Op | undefined, bestSkill: Skill | undefined;
    for (const owner of center?.ops ?? []) {
      let amount = zero();
      for (const s of skills(owner,"cc_reduce")) if ((!s.facility_types.length || s.facility_types.includes(room.type)) && condition(s,w,owner,op,room)) {
        amount = amount.add(s.value);
        if (amount.gt(best)) { bestOwner = owner; bestSkill = s; }
      }
      best = D.max(best,amount);
    }
    if (!best.eq(0)) add("consume","cc_reduce",best.neg(),bestOwner,bestSkill);
    const eliminate = room.ops.some(owner => skills(owner,"eliminate_self").some(s =>
      (!s.self_only || owner === op) && scope(s) && condition(s,w,owner,op,room)));
    if (eliminate) for (const e of entries) if (e.group === "self_consume") e.applied = false;
    if (center) {
      for (const s of skills(op,"dorm_self")) if (s.template_id === "M07b") emit("recover","self_recover",op,s);
      const spread = center.ops.some(o => o.mood.gt(0) && o.skills.some(s => s.spread_whitelist));
      for (const owner of center.ops) for (const s of skills(owner,"cc_recover")) {
        const reaches = (!s.facility_types.length || s.facility_types.includes(room.type)) ||
          (spread && catalog.spread.includes(baseId(s.id)) && workplace.includes(room.type));
        if (!reaches || !condition(s,w,owner,op,room)) continue;
        let amount = scaled(s,w,room,op,vars);
        if (amount === null) continue;
        if (s.count_faction) amount = amount.mul(countFaction(room.ops,s.count_faction));
        add("recover","cc_recover",amount,owner,s,s.max_group ? `owner:${s.max_group}` : undefined);
      }
    }
  } else if (room) {
    const exclusive = skills(op,"dorm_self").filter(s => s.exclusive).sort((a,b) => new D(b.value).cmp(a.value))[0];
    if (exclusive) add("recover","exclusive",new D(exclusive.value),op,exclusive);
    else {
      add("recover","dorm_base",new D("1.5").add(new D(room.level).mul("0.5")));
      for (const owner of center?.ops ?? []) for (const s of skills(owner,"cc_recover")) {
        if (!s.facility_types.includes("dormitory") || !condition(s,w,owner,op,room)) continue;
        let value = scaled(s,w,room,op,vars);
        if (value === null) continue;
        if (s.count_faction) value = value.mul(countFaction(room.ops,s.count_faction));
        add("recover","cc_dorm",value,owner,s);
      }
      for (const s of skills(op,"dorm_self")) if (!s.exclusive) emit("recover","dorm_self",op,s,"skill:dorm_self");
      let pool: Skill | undefined;
      for (const owner of room.ops) for (const s of skills(owner,"dorm_group")) {
        if (s.pool) { if (!pool || new D(s.value).gt(pool.value)) pool=s; }
        else emit("recover","dorm_group",owner,s,"skill:dorm_group");
      }
      const providers = room.ops.filter(o => skills(o,"dorm_single").length);
      const beneficiary = room.ops.filter(o => o.mood.lt(24) && !providers.includes(o)).sort((a,b) => a.mood.cmp(b.mood))[0];
      if (beneficiary === op) for (const owner of providers) for (const s of skills(owner,"dorm_single")) emit("recover","dorm_single",owner,s,"skill:dorm_single");
      for (const owner of room.ops) for (const s of skills(owner,"dorm_targeted")) emit("recover","dorm_targeted",owner,s);
      for (const owner of room.ops) for (const s of skills(owner,"dorm_meta")) {
        if (!condition(s,w,owner,op,room) || !room.ops.some(o => o.name === s.boost_provider && o.mood.gt(0))) continue;
        const amount = scaled(s,w,room,op,vars);
        if (!amount || amount.lte(0)) continue;
        const targets = entries.filter(e => e.side === "recover" && e.owner === s.boost_provider && (!s.boost_group || s.boost_group === e.group));
        for (const e of targets) entries.push({...e,value:amount});
      }
      const recipients = room.ops.filter(o => o.mood.lt(24));
      if (pool && recipients.includes(op)) add("recover","dorm_pool",new D(pool.value).div(recipients.length),undefined,pool);
    }
  }
  const aggregate = (side: Entry["side"]) => {
    const items = entries.filter(e => e.side === side && e.applied);
    const groups = new Map<string, Map<string, Decimal>>();
    for (const e of items) if (e.aggregation) {
      const group = groups.get(e.aggregation) ?? new Map<string,Decimal>();
      const key = e.aggregation.startsWith("owner:") ? e.owner! : `${e.owner}:${baseId(e.skill!)}`;
      group.set(key,(group.get(key) ?? zero()).add(e.value)); groups.set(e.aggregation,group);
    }
    let sum = zero();
    for (const e of items) {
      if (!e.aggregation) { sum=sum.add(e.value); continue; }
      const group = groups.get(e.aggregation)!;
      const winner = [...group].reduce((a,b) => b[1].gt(a[1]) ? b : a);
      const key = e.aggregation.startsWith("owner:") ? e.owner! : `${e.owner}:${baseId(e.skill!)}`;
      e.applied = key === winner[0];
    }
    for (const [key,group] of groups) sum=sum.add(key.startsWith("owner:") ? D.max(0,...group.values()) : D.max(...group.values()));
    return sum;
  };
  const consume=D.max(0,aggregate("consume")), recover=aggregate("recover");
  return {consume,recover,net:consume.sub(recover),entries};
}
export function serializeLedger(lg: Ledger): MoodRate {
  return {consume:lg.consume.toNumber(),recover:lg.recover.toNumber(),net:lg.net.toNumber(),
    items:lg.entries.map(e => ({...e,value:e.value.toNumber()}))};
}
