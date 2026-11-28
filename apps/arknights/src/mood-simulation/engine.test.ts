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

test("reference skill and room rates match Python with the game working-state adjustment", () => {
  for (const [index,fixture] of fixtures.rates.entries()) {
    const w: World = {initial:{},rooms:fixture.rooms.map((r,i) => ({
      id:String(i),type:r.type,level:r.level,capacity:5,ops:r.operators.map(o => ({...operator(o.name,o.elite,o.level),mood:new D(o.mood)})),
    }))};
    const center = fixture.rooms.find(room => room.type === "control_center");
    const inactiveCenter = center?.operators.filter(op => op.mood === 0).length ?? 0;
    for (const r of w.rooms) for (const o of r.ops) {
      const got=ledger(w,o), expected=(fixture.rates as Record<string,number[]>)[o.name]!;
      // The pinned model keeps counting depleted occupants. Remove the resulting
      // increase from our rate to compare the rest of the ledger independently.
      const productionRoom = ["manufacturing", "trading"].includes(r.type);
      const active = r.ops.filter(op => op.mood.gt(0)).length;
      const lostFacilitySteps = productionRoom ? Math.min(2, r.ops.length - 1) - Math.min(2, Math.max(0, active - 1)) : 0;
      const lostCenterSteps = r.type === "dormitory" ? 0 : inactiveCenter;
      const referenceConsume = D.max(0, got.consume.sub(new D(lostFacilitySteps + lostCenterSteps).mul("0.05")));
      assert.ok(referenceConsume.sub(expected[0]!).abs().lt("0.000001"), `case ${index} ${o.name} consumption ${referenceConsume} != ${expected[0]}`);
      const recover = r.type === "dormitory" && o.name === "菲亚梅塔" && o.mood.eq(0) ? 2 : expected[1]!;
      assert.ok(got.recover.sub(recover).abs().lt("0.000001"), `case ${index} ${o.name} recovery ${got.recover} != ${recover}`);
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
      fiammetta:{0:{enabled:true,mode:"specified"},1:{enabled:true,mode:"specified"}}},
    draft:{version:3,scheduleMode:"sequential",externalOperatorNames:[],startTime:"04:00",activeShift:0,fiammettaEnabled:true,
      shifts:f.shifts.map((s,i) => ({durationHours:i===0?11.5:12.5,fiammettaTarget:f.target,droneTargetRoomId:null,
        rooms:Object.fromEntries(s.map((r,j) => [String(j),{operators:r.operators}]))}))},
  };
}
test("1/3/7-cycle trajectories match Python until a worker stops contributing shared reductions", () => {
  for (const [index,f] of fixtures.trajectories.entries()) {
    const input=referenceInput(f),before=JSON.stringify(input),result=simulate(input);
    assert.equal(JSON.stringify(input),before,"simulation must not mutate the schedule or roster");
    const firstDepletion = f.points.find(({time,moods}) => {
      const layout = f.layouts.filter(snapshot => snapshot.time <= time).at(-1);
      return input.layout.rooms.some(({id,kind}) => {
        const occupants = layout?.rooms[id] ?? [];
        const contributes = kind === "control_center" || (kind === "trade_post" && occupants.length > 1);
        return contributes && occupants.some(name => moods[name] === 0);
      });
    })?.time ?? Infinity;
    for (const point of f.points) {
      if (point.time >= firstDepletion) break;
      const moods=pointAt(result,point.time);
      for (const [name,value] of Object.entries(point.moods)) assert.ok(Math.abs(moods[name]!-value)<1e-6,`trajectory ${index}, t=${point.time}, ${name}: ${moods[name]} != ${value}`);
    }
    for (const p of result.points) for (const mood of Object.values(p.moods)) assert.ok(mood>=0 && mood<=24);
    for (const snapshot of f.layouts) {
      if (snapshot.time >= firstDepletion) break;
      assert.deepEqual(segmentAt(result,snapshot.time).rooms,snapshot.rooms,`trajectory ${index} layout at ${snapshot.time}`);
    }
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

function lockedDormInput(): MoodSimulationInput {
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
  };
}

function fiammettaLockInput(): MoodSimulationInput {
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
      fiammetta: { 0: { enabled: true, mode: "specified" }, 1: { enabled: true, mode: "specified" } } },
    fiammettaEnabled: true,
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

test("recycle mood rates stack the working center bonus with 国度's own skill only", () => {
  for (const partner of ["旅骨", "行铃"]) {
    const input = recycleInput(["国度", partner]);
    input.layout.rooms.push({ id: "center", kind: "control_center", level: 5 });
    input.draft.shifts[0]!.rooms.center = { operators: ["香草", "翎羽", "芬", "克洛丝", "米格鲁"] };
    const result = simulate(input);
    assert.equal(detailAt(input, result, 12, "国度").net, 0.65);
    assert.equal(detailAt(input, result, 12, partner).net, 0.75);
  }
});

test("multi-day schedules use their actual shift lengths and retain mood across cycles", () => {
  const input = recycleInput(["国度"]);
  input.layout.rooms.push({ id: "dorm", kind: "dormitory", level: 5 });
  const work = input.draft.shifts[0]!;
  const rest = { ...work, rooms: { dorm: { operators: ["国度"] } } };
  input.draft.scheduleMode = "period";
  input.draft.shifts = [work, { ...rest, durationHours: 12 }];
  input.settings.cycles = 3;

  const result = simulate(input);
  assert.equal(result.total, 108);
  assert.deepEqual(result.segments.map(segment => segment.start), [0, 24, 36, 60, 72, 96]);
  assert.equal(segmentAt(result, 24).rooms.dorm?.[0], "国度");
  assert.equal(pointAt(result, 24)["国度"], 2.4);
  assert.equal(pointAt(result, 30)["国度"], 24);
  assert.equal(pointAt(result, 37)["国度"], 23.1);
  const series = result.series.find(group => group.names.includes("国度"))!;
  assert.ok(series.points.some(point => point.time === 24 && point.mood === 2.4));
  assert.ok(series.points.some(point => point.time === 29.4 && point.mood === 24));

  input.draft.scheduleMode = "sequential";
  input.draft.shifts = [work, rest];
  input.settings.cycles = 7;
  const sevenCycles = simulate(input);
  assert.equal(sevenCycles.total, 336);
  assert.equal(segmentAt(sevenCycles, 336).end, 336);
  assert.equal(sevenCycles.cycleEnds.length, 7);
});

test("shift times keep minute precision and reject unsupported cycle lengths", () => {
  const input = recycleInput(["芬"]);
  const shift = input.draft.shifts[0]!;
  input.draft.shifts = [47 / 60, 12, 23 + 13 / 60].map(durationHours => ({ ...shift, durationHours }));
  const result = simulate(input);
  assert.equal(result.total, 36);
  assert.equal(result.segments[0]!.end, 47 / 60);
  assert.equal(result.segments.at(-1)!.end, 36);
  input.draft.shifts[2]!.durationHours = 24;
  assert.throws(() => simulate(input), /Shift durations must total/);
});

test("only working occupants provide the shared mood reductions", () => {
  const target = operator("旅骨");
  const exhaustedCenter = { ...operator("香草"), mood: new D(0) };
  const exhaustedColleague = { ...operator("翎羽"), mood: new D(0) };
  const world: World = { initial: {}, rooms: [
    { id: "center", type: "control_center", level: 2, capacity: 2, ops: [exhaustedCenter, operator("芬")] },
    { id: "room", type: "trading", level: 3, capacity: 3, ops: [exhaustedColleague, target] },
  ] };
  assert.equal(ledger(world, target).net.toNumber(), 0.95);
  world.rooms[1]!.type = "manufacturing";
  assert.equal(ledger(world, target).net.toNumber(), 0.95);
  world.rooms[1]!.type = "recycle";
  assert.equal(ledger(world, target).net.toNumber(), 0.95);
});

test("center exhaustion changes the recycling operators' rates mid-shift", () => {
  const input = recycleInput(["国度", "旅骨"]);
  input.layout.rooms.push({ id: "center", kind: "control_center", level: 5 });
  const work = input.draft.shifts[0]!;
  const center = { operators: ["香草"] };
  input.draft.shifts = [
    { ...work, rooms: { center } },
    { ...work, rooms: { ...work.rooms, center } },
  ];
  const result = simulate(input);
  const exhaustion = result.points.find(point => point.moods["香草"] === 0)!;
  assert.ok(Math.abs(exhaustion.time - 24 / 0.95) < 1e-9);
  assert.equal(detailAt(input, result, exhaustion.time - 0.1, "国度").net, 0.85);
  assert.equal(detailAt(input, result, exhaustion.time, "国度").net, 0.9);
  assert.equal(detailAt(input, result, exhaustion.time, "旅骨").net, 1);
  for (const [name, rate] of [["国度", 0.9], ["旅骨", 1]] as const) {
    const later = pointAt(result, exhaustion.time + 0.1)[name]!;
    assert.ok(Math.abs(later - (exhaustion.moods[name]! - 0.1 * rate)) < 1e-9);
  }
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

test("idle admission uses vacant beds without displacing any dorm occupant", () => {
  const result = simulate(lockedDormInput());
  assert.ok(!result.events.some(event => event.kind === "idle" && event.operator === "芬"));
  assert.deepEqual(segmentAt(result,12).rooms.dorm,["阿米娅"]);
  assert.deepEqual(segmentAt(result,12).rooms.training,["芬"]);
});

test("idle admission fills dorms left to right, prioritizing non-full Fiammetta then ascending morale", () => {
  const input = recycleInput(["国度","芬"]);
  input.layout.rooms.push({id:"power",kind:"power_plant",level:1},
    {id:"first",kind:"dormitory",level:1,dorm_beds:2}, {id:"second",kind:"dormitory",level:1,dorm_beds:2});
  const work = input.draft.shifts[0]!;
  work.rooms.power = {operators:["菲亚梅塔"]};
  input.draft.shifts = [{...work,durationHours:12},{...work,durationHours:12,rooms:{}}];
  input.draft.dormLocks = [{roomId:"first",slotIndex:0,fromShift:1,operator:null}];
  input.settings.idleEnabled = true;
  const rest = segmentAt(simulate(input),12);
  assert.deepEqual(rest.dormSlots,{first:[null,"菲亚梅塔"],second:["芬","国度"]});
  assert.deepEqual(rest.lockedDormSlots?.first,[0]);

  delete work.rooms.power;
  input.operbox.push({id:"fiammetta",name:"菲亚梅塔",own:true,elite:2,level:1,potential:1,rarity:6});
  const full = segmentAt(simulate(input),12);
  assert.deepEqual(full.dormSlots,{first:[null,"芬"],second:["国度",null]});
});

test("Fiammetta swaps only in shifts with a named target or an enabled automatic mode", () => {
  const input = fiammettaLockInput();
  input.operbox.push({id:"char_123_fang",name:"芬",own:true,elite:1,level:55,potential:1,rarity:3});
  input.draft.shifts = ["阿米娅", "芬", null].map(fiammettaTarget => ({
    ...input.draft.shifts[0]!, durationHours:8, fiammettaTarget,
    rooms:{dorm:{operators:["菲亚梅塔"]},factory:{operators:["阿米娅","芬"]}},
  }));
  input.settings.fiammetta = {};
  const swaps = () => simulate(input).events.filter(event => event.kind === "entry").map(event => [event.time, event.target]);
  const named = [[0,"阿米娅"],[8,"芬"]];
  assert.deepEqual(swaps(), named);

  input.settings.fiammetta[2] = {enabled:true,mode:"specified"};
  assert.deepEqual(swaps(), named);
  input.settings.fiammetta[2] = {enabled:true,mode:"auto"};
  assert.deepEqual(swaps(), [...named,[16,"阿米娅"]]);

  input.settings.fiammetta[1] = {enabled:false,mode:"specified"};
  input.settings.fiammetta[2] = {mode:"auto"};
  assert.deepEqual(swaps(), [[0,"阿米娅"]]);
});

test("a locked Fiammetta swaps morale and stays in her bed through subsequent shifts and cycles", () => {
  const input = fiammettaLockInput();
  input.draft.shifts[1] = {...input.draft.shifts[1]!,rooms:{factory:{operators:["菲亚梅塔","阿米娅"]}}};
  input.draft.dormLocks = [{roomId:"dorm",slotIndex:1,fromShift:0,operator:"菲亚梅塔"}];
  input.settings.cycles = 2;
  const result = simulate(input);
  assert.ok(result.events.some(event => event.kind === "entry" && event.time === 12));
  assert.equal(pointAt(result,12)["菲亚梅塔"],12);
  assert.equal(pointAt(result,12)["阿米娅"],24);
  for (const segment of result.segments) {
    assert.equal(segment.dormSlots?.dorm?.[1],"菲亚梅塔");
    assert.ok(!segment.rooms.factory?.includes("菲亚梅塔"));
  }
});

test("Fiammetta can swap without entering a dorm and can wait for 24 after automatic admission", () => {
  const input = fiammettaLockInput();
  const first = input.draft.shifts[0]!;
  const working = {...first,rooms:{factory:{operators:["阿米娅"]}}};
  input.draft.shifts = [working,working];
  input.settings.fiammetta[0]!.enabled = false;
  const result = simulate(input);
  assert.ok(result.events.some(event => event.kind === "entry" && event.time === 12));
  assert.equal(pointAt(result,12)["阿米娅"],24);
  assert.deepEqual(segmentAt(result,12).rooms.dorm,[]);

  input.layout.rooms.push({id:"power",kind:"power_plant",level:1});
  input.draft.shifts[0] = {...working,rooms:{...working.rooms,power:{operators:["菲亚梅塔"]}}};
  input.settings.idleEnabled = true;
  const recovering = simulate(input);
  assert.equal(segmentAt(recovering,12).dormSlots?.dorm?.[0],"菲亚梅塔");
  assert.equal(pointAt(recovering,12)["菲亚梅塔"],12);
  assert.ok(recovering.events.some(event => event.kind === "entry" && event.time === 18));
  assert.equal(pointAt(recovering,18)["阿米娅"],24);
});

test("Fiammetta recovers at her own fixed rate after swapping with a depleted operator", () => {
  const input = fiammettaLockInput();
  const first = {...input.draft.shifts[0]!,durationHours:24};
  input.draft.shifts = [first,first];
  input.settings.fiammetta[0]!.enabled = false;
  const result = simulate(input);
  assert.equal(pointAt(result,24)["菲亚梅塔"],0);
  assert.equal(detailAt(input,result,24,"菲亚梅塔").recover,2);
  assert.equal(pointAt(result,25)["菲亚梅塔"],2);
});
