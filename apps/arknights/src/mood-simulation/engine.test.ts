import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { D, catalog, ledger, operator, type Skill, type World } from "./rules.ts";
import { detailAt, pointAt, segmentAt, simulate, prepare } from "./engine.ts";
import { roomCapacity } from "./rooms.ts";
import { moodCatalogAdditions } from "./catalog-additions.ts";
import { defaultMoodSettings, type MoodSimulationInput } from "./types.ts";
import type { RoomKind } from "@riic/arknights-domain/types";
type FixtureRoom = { type: string; level: number; operators: {name: string; elite: number; level: number; mood: number}[] };
type TrajectoryFixture = {shifts: {type: string;level: number;operators: string[]}[][];cycles: number;idle: boolean;target: string;points: {time: number;moods: Record<string,number>}[];layouts:{time:number;rooms:Record<string,string[]>}[]};
const fixtures = JSON.parse(readFileSync(new URL("./reference-fixtures.json",import.meta.url),"utf8")) as {
  rates: {rooms: FixtureRoom[];rates: Record<string,number[]>}[];trajectories: TrajectoryFixture[];
};

test("all reference skill/unlock/mood and interacting-room rates match Python", () => {
  for (const [index,fixture] of fixtures.rates.entries()) {
    const w: World = {initial:{},rooms:fixture.rooms.map((r,i) => ({
      id:String(i),type:r.type,level:r.level,capacity:5,ops:r.operators.map(o => ({...operator(o.name,o.elite,o.level),mood:new D(o.mood)})),
    }))};
    for (const r of w.rooms) for (const o of r.ops) {
      const got=ledger(w,o), expected=(fixture.rates as Record<string,number[]>)[o.name]!;
      assert.ok(got.consume.sub(expected[0]!).abs().lt("0.000001"), `case ${index} ${o.name} consumption ${got.consume} != ${expected[0]}`);
      assert.ok(got.recover.sub(expected[1]!).abs().lt("0.000001"), `case ${index} ${o.name} recovery ${got.recover} != ${expected[1]}`);
    }
  }
});
const kinds: Record<string,RoomKind>={control_center:"control_center",trading:"trade_post",dormitory:"dormitory"};

test("new operators have explicit mood rules and unlock conditions", () => {
  const clem = operator("克莱门莎", 2, 1);
  const world: World = { initial: {}, rooms: [{ id: "meet", type: "reception", level: 3, capacity: 2, ops: [clem] }] };
  assert.equal(ledger(world, clem).consume.toNumber(), 2);
  world.rooms[0]!.ops.push(operator("芬"));
  assert.equal(ledger(world, clem).consume.toNumber(), 3);
  const rookie = operator("克莱门莎", 0, 1);
  world.rooms[0]!.ops[0] = rookie;
  assert.equal(ledger(world, rookie).consume.toNumber(), 2);
  const toledo = operator("德·托莱多", 2, 1);
  world.rooms = [{ id: "office", type: "office", level: 3, capacity: 1, ops: [toledo] }];
  assert.equal(ledger(world, toledo).consume.toNumber(), 0.75);
  assert.equal(toledo.skills.filter(skill => skill.kind === "self_consume").length, 1);
  assert.equal(toledo.skills.filter(skill => skill.kind === "dorm_group").length, 2);
  assert.equal(operator("德·托莱多", 0, 1).skills.some(skill => skill.kind === "dorm_group"), false);
  assert.equal(operator("旅骨").skills.length, 0);
});

test("a BOX with new operators no longer aborts simulation; unknown assigned names still fail", () => {
  const input = structuredClone(referenceInput(fixtures.trajectories[0]!));
  for (const name of ["克莱门莎", "德·托莱多", "旅骨", "Future unassigned operator"]) input.operbox.push({ id: name, name, own: true, elite: 2, level: 1, potential: 0, rarity: 5 });
  const result = simulate(input);
  assert.ok(result.names.includes("克莱门莎"));
  assert.equal(result.names.includes("Future unassigned operator"), false);
  const roomId = input.layout.rooms[0]!.id;
  input.draft.shifts[0]!.rooms[roomId]!.operators[0] = "Future unassigned operator";
  assert.throws(() => prepare(input), /Unknown operator/);
});
export function referenceInput(f: typeof fixtures.trajectories[number]): MoodSimulationInput {
  const names=[...new Set(f.shifts.flatMap(s => s.flatMap(r => r.operators)))];
  return {
    layout:{template:"test",drone_cap:200,scenario:{},rooms:f.shifts[0]!.map((r,i) => ({id:String(i),kind:kinds[r.type]!,level:r.level,dorm_beds:5}))},
    operbox:names.map(name => ({id:name,name,own:true,elite:2,level:30,potential:0,rarity:5})),
    fiammettaEnabled:true,
    settings:{...defaultMoodSettings(),cycles:f.cycles,idleEnabled:f.idle,
      fiammetta:{0:{enabled:true,mode:"specified",wait:true},1:{enabled:true,mode:"specified",wait:true}}},
    draft:{version:3,scheduleMode:"sequential",externalOperatorNames:[],startTime:"04:00",activeShift:0,fiammettaEnabled:true,
      shifts:f.shifts.map((s,i) => ({durationHours:i===0?11.5:12.5,fiammettaTarget:f.target,droneTargetRoomId:null,
        rooms:Object.fromEntries(s.map((r,j) => [String(j),{operators:r.operators}]))}))},
  };
}
test("1/3/7-cycle trajectories, waiting and idle admission match Python", () => {
  for (const [index,f] of fixtures.trajectories.entries()) {
    const input=referenceInput(f),before=JSON.stringify(input),result=simulate(input);
    assert.equal(JSON.stringify(input),before,"simulation must not mutate the schedule or roster");
    for (const point of f.points) {
      const moods=pointAt(result,point.time);
      for (const [name,value] of Object.entries(point.moods)) assert.ok(Math.abs(moods[name]!-value)<1e-6,`trajectory ${index}, t=${point.time}, ${name}: ${moods[name]} != ${value}`);
    }
    for (const p of result.points) for (const mood of Object.values(p.moods)) assert.ok(mood>=0 && mood<=24);
    for (const snapshot of f.layouts) assert.deepEqual(segmentAt(result,snapshot.time).rooms,snapshot.rooms,`trajectory ${index} layout at ${snapshot.time}`);
    const detail=detailAt(input,result,12,f.target);
    assert.ok(Number.isFinite(detail.net));
  }
});
test("same-time jumps are right-continuous; playback does not interpolate a jump backwards", () => {
  const result=simulate(referenceInput(fixtures.trajectories[0]!));
  const mood=(point: {moods: Record<string, number>},name: string) => point.moods[name] ?? 24;
  const jump=result.points.findIndex((p,i) => i>0 && p.time===result.points[i-1]!.time &&
    result.names.some(n => mood(p,n)!==mood(result.points[i-1]!,n)));
  assert.ok(jump>0);
  const before=result.points[jump-1]!,after=result.points[jump]!;
  const right=pointAt(result,after.time);
  for (const n of result.names) assert.equal(right[n],mood(after,n));
  const name=result.names.find(n => mood(before,n)!==mood(after,n))!;
  assert.ok(Math.abs(pointAt(result,after.time-1e-8)[name]!-mood(before,name))<1e-6);
});

function recycleInput(names: string[], elite = 2): MoodSimulationInput {
  return {
    layout: { template: "test", drone_cap: 200, scenario: {}, rooms: [{ id: "recycle", kind: "recycle", level: 3 }] },
    operbox: names.map(name => ({ id: name, name, own: true, elite, level: 30, potential: 0, rarity: 5 })),
    draft: {
      version: 3, scheduleMode: "sequential", externalOperatorNames: [], startTime: "08:00", activeShift: 0,
      fiammettaEnabled: false,
      shifts: [{ durationHours: 24, fiammettaTarget: null, droneTargetRoomId: null, rooms: { recycle: { operators: names } } }],
    },
    settings: { ...defaultMoodSettings(), idleEnabled: false },
    fiammettaEnabled: false,
  };
}

function roomInput(kind: RoomKind, level: number, names: string[], dormBeds?: number): MoodSimulationInput {
  const room = { id: "room", kind, level, ...(dormBeds === undefined ? {} : { dorm_beds: dormBeds }) };
  return {
    layout: { template: "test", drone_cap: 200, scenario: {}, rooms: [room] },
    operbox: names.map(name => ({ id: name, name, own: true, elite: 2, level: 30, potential: 0, rarity: 5 })),
    draft: {
      version: 3, scheduleMode: "sequential", externalOperatorNames: [], startTime: "08:00", activeShift: 0,
      fiammettaEnabled: false,
      shifts: [{ durationHours: 24, fiammettaTarget: null, droneTargetRoomId: null, rooms: { room: { operators: names } } }],
    },
    settings: { ...defaultMoodSettings(), idleEnabled: false },
    fiammettaEnabled: false,
  };
}

function lockedDormInput(lock?: string): MoodSimulationInput {
  return {
    layout: {
      template: "test", drone_cap: 200, scenario: {},
      rooms: [
        { id: "dorm", kind: "dormitory", level: 5, dorm_beds: 1 },
        { id: "factory", kind: "factory", level: 3 },
        { id: "training", kind: "training_room", level: 3 },
      ],
    },
    operbox: [
      { id: "char_002_amiya", name: "阿米娅", own: true, elite: 2, level: 30, potential: 0, rarity: 5 },
      { id: "char_123_fang", name: "芬", own: true, elite: 2, level: 30, potential: 0, rarity: 5 },
    ],
    draft: {
      version: 3, scheduleMode: "sequential", externalOperatorNames: [], startTime: "08:00", activeShift: 0,
      fiammettaEnabled: false,
      shifts: [
        { durationHours: 12, fiammettaTarget: null, droneTargetRoomId: null,
          rooms: { dorm: { operators: ["阿米娅"] }, factory: { operators: ["芬"] } } },
        { durationHours: 12, fiammettaTarget: null, droneTargetRoomId: null,
          rooms: { dorm: { operators: ["阿米娅"] }, training: { operators: ["芬"] } } },
      ],
    },
    settings: { ...defaultMoodSettings(), idleEnabled: true },
    fiammettaEnabled: false,
    ...(lock ? { dormLocks: [lock] } : {}),
  };
}

function fiammettaLockInput(lock: string): MoodSimulationInput {
  const shift = { durationHours: 12, fiammettaTarget: "阿米娅", droneTargetRoomId: null,
    rooms: { dorm: { operators: ["菲亚梅塔"] }, factory: { operators: ["阿米娅"] } } };
  return {
    layout: {
      template: "test", drone_cap: 200, scenario: {},
      rooms: [
        { id: "dorm", kind: "dormitory", level: 5 },
        { id: "factory", kind: "factory", level: 3 },
      ],
    },
    operbox: [
      { id: "char_300_phenxi", name: "菲亚梅塔", own: true, elite: 0, level: 30, potential: 0, rarity: 6 },
      { id: "char_002_amiya", name: "阿米娅", own: true, elite: 2, level: 30, potential: 0, rarity: 5 },
    ],
    draft: { version: 3, scheduleMode: "sequential", externalOperatorNames: [], startTime: "08:00", activeShift: 0,
      fiammettaEnabled: true, shifts: [shift, shift] },
    settings: { ...defaultMoodSettings(), idleEnabled: false,
      fiammetta: { 0: { enabled: true, mode: "specified", wait: false }, 1: { enabled: true, mode: "specified", wait: false } } },
    fiammettaEnabled: true,
    dormLocks: [lock],
  };
}

test("recycle station accepts two operators and charges the base rate", () => {
  const input = recycleInput(["阿米娅", "芬"]);
  const result = simulate(input);
  assert.equal(pointAt(result, 12)["阿米娅"], 12);
  assert.equal(pointAt(result, 12)["芬"], 12);
  assert.equal(detailAt(input, result, 1, "阿米娅").consume, 1);
});

test("recycle capacity follows the game-data level table", () => {
  assert.doesNotThrow(() => simulate(roomInput("recycle", 1, ["阿米娅"])));
  assert.throws(() => simulate(roomInput("recycle", 1, ["阿米娅", "芬"])), /Room capacity exceeded/);
  assert.doesNotThrow(() => simulate(roomInput("recycle", 2, ["阿米娅", "芬"])));
  assert.doesNotThrow(() => simulate(roomInput("recycle", 3, ["阿米娅", "芬"])));
});

test("control center capacity follows the game-data level table", () => {
  const five = ["阿米娅", "芬", "凯尔希", "陈", "令"];
  assert.throws(() => simulate(roomInput("control_center", 3, five)), /Room capacity exceeded/);
  assert.doesNotThrow(() => simulate(roomInput("control_center", 5, five)));
});

test("capacity table matches the game-data room phases", () => {
  const cases: Array<[RoomKind, number, number | undefined, number]> = [
    ["control_center", 1, undefined, 1],
    ["control_center", 3, undefined, 3],
    ["control_center", 5, undefined, 5],
    ["dormitory", 5, 4, 4],
    ["dormitory", 5, 6, 5],
    ["dormitory", 5, undefined, 5],
    ["factory", 1, undefined, 1],
    ["factory", 2, undefined, 2],
    ["factory", 5, undefined, 3],
    ["trade_post", 5, undefined, 3],
    ["meeting_room", 3, undefined, 2],
    ["training_room", 1, undefined, 2],
    ["power_plant", 3, undefined, 1],
    ["office", 3, undefined, 1],
    ["workshop", 3, undefined, 1],
    ["recycle", 1, undefined, 1],
    ["recycle", 2, undefined, 2],
    ["recycle", 3, undefined, 2],
  ];
  for (const [kind, level, beds, expected] of cases) {
    assert.equal(roomCapacity(kind, level, beds), expected, `${kind} L${level} beds=${beds}`);
  }
});

test("points omit operators that stay at full mood", () => {
  const input = roomInput("recycle", 3, ["阿米娅"]);
  input.operbox.push({ id: "芬", name: "芬", own: true, elite: 2, level: 30, potential: 0, rarity: 5 });
  const result = simulate(input);
  assert.ok(result.names.includes("芬"));
  assert.ok(result.points.every(point => !("芬" in point.moods)));
  assert.equal(pointAt(result, 0)["芬"], 24);
  assert.ok(result.points.some(point => "阿米娅" in point.moods));
});

test("国度 lowers its own recycle consumption without stacking the elite-2 upgrade", () => {
  const elite0 = recycleInput(["国度"], 0);
  assert.equal(detailAt(elite0, simulate(elite0), 1, "国度").consume, 0.9);
  const elite2 = recycleInput(["国度"], 2);
  assert.equal(detailAt(elite2, simulate(elite2), 1, "国度").consume, 0.9);
});

test("冻河 restores the dorm flat and per-underfull amounts", () => {
  const frost = { ...operator("冻河", 0, 1), mood: new D(20) };
  const rested = { ...operator("阿米娅", 2, 30), mood: new D(24) };
  const world: World = { initial: {}, rooms: [{ id: "dorm", type: "dormitory", level: 5, capacity: 5, ops: [frost, rested] }] };
  const entries = ledger(world, frost).entries.filter(entry => entry.skill?.startsWith("dorm_rec_all&unfull_100"));
  assert.deepEqual(entries.map(entry => entry.value.toNumber()), [0.1, 0.01]);
});

test("every operator in the project catalog has a mood rule entry", () => {
  const project = JSON.parse(readFileSync(new URL("../../../../packages/arknights-domain/src/generated/arkntools/operator-catalog.json", import.meta.url), "utf8")) as { name: string }[];
  assert.deepEqual(project.filter(entry => !catalog.knownOperators.includes(entry.name)).map(entry => entry.name), []);
});

function referenceCatalog() {
  return JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8")) as {
    skills: Record<string, Skill>;
    knownOperators: string[];
  };
}

test("catalog additions never shadow reference skills or operators", () => {
  const reference = referenceCatalog();
  const additions = moodCatalogAdditions();
  assert.deepEqual(Object.keys(additions.skills).filter(id => id in reference.skills), []);
  const known = new Set(reference.knownOperators);
  assert.deepEqual(Object.keys(additions.operators).filter(name => known.has(name)), []);
  const equips = additions.equips as Record<string, Record<string, unknown>>;
  for (const [name, ids] of Object.entries(additions.operators)) {
    for (const id of ids) assert.ok(equips[name]?.[id], `${name} ${id} missing equip`);
  }
});

test("catalog additions define their own fields instead of cloning", () => {
  const additions = moodCatalogAdditions();
  for (const skill of Object.values(additions.skills)) {
    assert.equal("note" in skill, false);
    assert.equal("partial" in skill, false);
  }
  const recycle = additions.skills["recycle_spd&cost_100#1"]!;
  assert.deepEqual(
    { kind: recycle.kind, value: recycle.value, facility_types: recycle.facility_types, basis: recycle.basis, template_id: recycle.template_id },
    { kind: "self_consume", value: "-0.1", facility_types: ["recycle"], basis: null, template_id: "M07a" },
  );
  const dorm = additions.skills["dorm_rec_all&unfull_100#2"]!;
  assert.equal(dorm.value, "0.01");
  assert.equal(dorm.basis, "dorm_unfull");
  const meet = additions.skills["meet_spd&cost_char_000#1"]!;
  assert.equal(meet.condition?.name, "_cond_with_other_operator");
});

test("locked dorm operator is not replaced by idle admission", () => {
  const unlocked = simulate(lockedDormInput());
  assert.ok(unlocked.events.some(event => event.kind === "idle" && event.operator === "芬"));
  assert.deepEqual(segmentAt(unlocked, 12).rooms["dorm"], ["芬"]);
  const locked = simulate(lockedDormInput("0:1:阿米娅"));
  assert.ok(!locked.events.some(event => event.kind === "idle" && event.operator === "芬"));
  assert.deepEqual(segmentAt(locked, 12).rooms["dorm"], ["阿米娅"]);
  assert.deepEqual(segmentAt(locked, 12).rooms["training"], ["芬"]);
});

test("dorm lock does not block Fiammetta mood swap", () => {
  for (const lock of ["0:1:阿米娅", "0:1:菲亚梅塔"]) {
    const result = simulate(fiammettaLockInput(lock));
    assert.ok(result.events.some(event => event.kind === "entry" && event.time === 12));
    const at = pointAt(result, 12);
    assert.equal(at["菲亚梅塔"], 12);
    assert.equal(at["阿米娅"], 24);
  }
});
