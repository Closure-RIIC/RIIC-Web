import "./i18n/test-setup.ts";
import assert from "node:assert/strict";
import test from "node:test";
import roster from "../../../fixtures/operbox_full_e2.json" with { type: "json" };
import { calculateMastery, eligibleMasteryTargets, masteryTrainers, availableMasteryEnvironments, unlockedMasterySkills, solveMastery, formatMasteryTime, type MasteryInput, type MasteryTrainer } from "./mastery.ts";
import { masteryInstructions, masteryClipboard } from "./mastery-presentation.ts";
import type { OperBoxEntry } from "@riic/arknights-domain/types";

function box(...names: string[]): OperBoxEntry[] {
  return names.map((name) => {
    const operator = roster.find((o) => o.name === name);
    assert.ok(operator, name);
    return { ...operator };
  });
}
function input(target: string, trainers: string[], overrides: Partial<MasteryInput> = {}): MasteryInput {
  const operbox = box(target,...trainers);
  return { operbox, targetId: operbox[0]!.id, current: 0, target: 3, controlBonus: true, bufferMinutes: 0, environment: {}, ...overrides };
}
const near = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual-expected) <= tolerance, `${actual} != ${expected}`);

test("document example: Irene twice, then W at M3 (17.282 hours)", () => {
  const value = input("埃癸斯",["艾丽妮","W"]);
  const before = JSON.stringify(value.operbox);
  const result = calculateMastery(value);
  const expected = (8/1.4 + 8/1.4 + 12/2.05)*3600;
  near(result.simple.totalSeconds,expected);
  near(result.fast.totalSeconds,expected);
  assert.deepEqual(result.simple.stages.map((s) => s.segments.map((p) => p.trainerName)),[["艾丽妮"],["艾丽妮"],["W"]]);
  assert.equal(result.simple.stages[2]!.activateWith?.name,"艾丽妮");
  const instructions = masteryInstructions(result.simple)[2]!;
  assert.match(instructions[0]!.text,/先开启专3/);
  assert.match(instructions[1]!.text,/减半生效后.*W/);
  assert.equal(JSON.stringify(value.operbox),before);
});

test("document defender relay: safe whole-second handoff and full 5 hours", () => {
  const result = calculateMastery(input("斩业星熊",["星熊","艾丽妮","望"]));
  const stage = result.fast.stages[0]!;
  assert.deepEqual(stage.segments.map((p) => p.trainerName),["星熊","艾丽妮"]);
  assert.ok(stage.segments[1]!.seconds >= 5*3600);
  near(result.fast.totalSeconds,(2.5/1.7+5)*3600*2+12/1.8*3600,2);
  assert.ok(result.fast.totalSeconds < result.simple.totalSeconds);
  const buffered = calculateMastery(input("斩业星熊",["星熊","艾丽妮","望"],{bufferMinutes:1}));
  assert.ok(buffered.fast.stages[0]!.segments[1]!.seconds >= 18060);
  assert.ok(buffered.fast.totalSeconds > result.fast.totalSeconds);
});

test("no reducer selects stage-specific speed and does not invent an initial halving", () => {
  const result = calculateMastery(input("埃癸斯",["黑","W"],{current:1}));
  assert.deepEqual(result.fast.stages.map((s) => s.segments[0]!.trainerName),["黑","W"]);
  near(result.fast.totalSeconds,(16/1.7+24/2.05)*3600);
  assert.ok(result.fast.stages.every((s) => !s.activateWith));
  const onlyM3 = calculateMastery(input("埃癸斯",["艾丽妮","W"],{current:2}));
  near(onlyM3.fast.totalSeconds,24/2.05*3600);
});

test("eligibility, target exclusion and no Box mutation", () => {
  const value = input("逻各斯",["艾丽妮","黑","W"]);
  value.operbox[1]!.own = false;
  value.operbox[2]!.elite = 1;
  assert.deepEqual(eligibleMasteryTargets(value.operbox).map((o) => o.name),["逻各斯","W"]);
  const trainers = masteryTrainers(value);
  assert.ok(!trainers.some((t) => ["逻各斯","艾丽妮"].includes(t.name)));
  assert.ok(trainers.some((t) => t.name === "黑"));
});

test("hypothetical E2 targets preserve webpage eligibility and actual trainer constraints", () => {
  const value = input("至简", ["逻各斯", "艾丽妮"], { target: 1 });
  const target = value.operbox[0]!;
  value.operbox[1]!.elite = 1;
  value.operbox[2]!.own = false;
  for (const entries of [[], [{ ...target, own: false }], [{ ...target, elite: 0 }], [{ ...target, elite: 1 }]]) {
    const operbox = [...entries, ...value.operbox.slice(1)];
    const before = structuredClone(operbox);
    const hypothetical = { ...value, operbox };
    assert.equal(eligibleMasteryTargets(operbox).length, 0);
    const trainers = masteryTrainers(hypothetical);
    assert.deepEqual(trainers.map((t) => t.name), ["逻各斯"]);
    assert.equal(trainers[0]!.halves, false);
    assert.deepEqual(calculateMastery(hypothetical), calculateMastery({ ...value, operbox: [target, ...value.operbox.slice(1)] }));
    assert.deepEqual(operbox, before);
  }
  assert.throws(() => calculateMastery({ ...value, targetId: box("芬")[0]!.id }));
});

test("empty trainer has no 5% placement bonus; ordinary owned trainer does", () => {
  const value = input("埃癸斯",[],{target:1,controlBonus:false});
  near(calculateMastery(value).fast.totalSeconds,8*3600);
  const ordinary = input("埃癸斯",["银灰"],{target:1,controlBonus:false});
  near(calculateMastery(ordinary).fast.totalSeconds,8/1.05*3600);
});

test("excludes operators whose progression is handled by Integrated Strategies", () => {
  const value = box("电弧", "机械师", "逻各斯");
  assert.deepEqual(eligibleMasteryTargets(value).map((o) => o.name), ["逻各斯"]);
  assert.throws(() => calculateMastery({
    operbox: value,
    targetId: value[0]!.id,
    current: 0,
    target: 1,
    controlBonus: false,
    bufferMinutes: 0,
    environment: {},
  }));
});

test("legacy short and name-only IDs resolve locally without changing imported Box", () => {
  const value = input("埃癸斯",["艾丽妮","W"]);
  const expected = calculateMastery(value).fast.totalSeconds;
  value.operbox = value.operbox.map((operator,index) => ({...operator,id:index % 2 ? operator.name : operator.id.replace(/^char_/,"")}));
  const before = JSON.stringify(value.operbox);
  assert.ok(eligibleMasteryTargets(value.operbox).some((o) => o.id === value.targetId));
  near(calculateMastery(value).fast.totalSeconds,expected);
  assert.equal(JSON.stringify(value.operbox),before);
});

test("branch, profession and stage bonuses; upgraded skills replace predecessors", () => {
  const value = input("纯烬艾雅法拉",["凛御银灰"]);
  value.operbox = box("桑葚","纯烬艾雅法拉"); value.targetId = value.operbox[0]!.id;
  let trainer = masteryTrainers(value)[0]!;
  near(trainer.bonuses[1],75);
  assert.deepEqual(unlockedMasterySkills(value.operbox[1]!),["train_spd&profession3_181"]);
  value.operbox[1]!.elite = 1;
  trainer = masteryTrainers(value)[0]!;
  near(trainer.bonuses[1],30);
  const vanguard = masteryTrainers(input("推进之王",["凛御银灰"]))[0]!;
  near(vanguard.bonuses[1],30); near(vanguard.bonuses[3],80);
  near(masteryTrainers(input("银灰",["凛御银灰"]))[0]!.bonuses[3],0);
  near(masteryTrainers(input("斩业星熊",["星熊"]))[0]!.bonuses[1],60);
});

test("environment defaults to zero, stacks separate skills, and obeys per-skill cap", () => {
  const value = input("银灰",["乌尔比安","余"]);
  assert.deepEqual(availableMasteryEnvironments(value.operbox,value.targetId),["fireworks","abyssal"]);
  near(masteryTrainers(value).find((t) => t.name === "乌尔比安")!.bonuses[1],30);
  value.environment = {abyssal:5,fireworks:72};
  const trainers = masteryTrainers(value);
  near(trainers.find((t) => t.name === "乌尔比安")!.bonuses[1],80);
  near(trainers.find((t) => t.name === "余")!.bonuses[1],72);
  assert.throws(() => calculateMastery({...value, environment:{abyssal:6}}));
});

test("both reducers are evaluated; underleveled reducer cannot prime halving", () => {
  const value = input("阿米娅",["逻各斯","艾丽妮"]);
  const result = calculateMastery(value);
  assert.equal(result.simple.stages[0]!.segments[0]!.trainerName,"逻各斯");
  value.operbox[1]!.elite = 1;
  assert.equal(masteryTrainers(value).find((t) => t.name === "逻各斯")!.halves,false);
  assert.notEqual(calculateMastery(value).simple.stages[0]!.nextHalvingTrainerId,value.operbox[1]!.id);
});

test("insufficient uninterrupted work cannot carry a halving; no negative segments", () => {
  const value = input("阿米娅",["逻各斯","艾丽妮"],{bufferMinutes:1000});
  const result = calculateMastery(value);
  for (const stage of result.fast.stages) {
    assert.equal(stage.nextHalvingTrainerId,null);
    assert.equal(stage.activateWith,null);
    assert.ok(stage.segments.every((s) => s.seconds > 0));
  }
});

test("rejects bad inputs and formats time with safe rounding", () => {
  const value = input("银灰",[]);
  for (const changes of [{current:2,target:1},{bufferMinutes:NaN},{bufferMinutes:-1},{environment:{fireworks:-1}},{environment:{fireworks:0.1}},{targetId:"missing"}]) {
    assert.throws(() => calculateMastery({...value,...changes} as MasteryInput));
  }
  assert.equal(formatMasteryTime(3599.2),"1:00:00");
  assert.match(masteryClipboard(calculateMastery(value).simple,"银灰"),/省操作/);
});

test("fast solver matches independent minute-grid exhaustive two-stage schedules", () => {
  for (const bonus of [0,30,60,95]) {
    const trainers: MasteryTrainer[] = [
      {id:"a",name:"A",halves:false,bonuses:{1:bonus,2:bonus,3:bonus},skillIds:[]},
      {id:"b",name:"B",halves:true,bonuses:{1:30,2:30,3:30},skillIds:[]},
    ];
    const value = input("阿米娅",[],{current:1,controlBonus:false});
    const r = (t: MasteryTrainer) => 1.05+t.bonuses[2]/100;
    let best = Infinity;
    // Enumerate one handoff at every minute, then every final-stage trainer.
    for (const first of trainers) for (const last of trainers) {
      for (let prefix=0; prefix <= 16*3600/r(first); prefix += 60) {
        const suffix = (16*3600-prefix*r(first))/r(last);
        const continuous = first === last ? prefix+suffix : suffix;
        const halved = last.halves && continuous >= 18000;
        for (const final of trainers) best = Math.min(best,prefix+suffix+(halved ? 12:24)*3600/r(final));
      }
    }
    const actual = solveMastery(value,trainers,"fast").totalSeconds;
    assert.ok(actual <= best+1e-6);
    assert.ok(best-actual < 60);
  }
});
