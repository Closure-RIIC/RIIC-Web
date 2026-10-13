import assert from "node:assert/strict";
import test from "node:test";
import { operatorsWithoutLayoutSkills, operatorsWithoutRoomSkills } from "./layout-skill-highlight.ts";
import { OPERATOR_CATALOG } from "./operatorPortraits.ts";

test("all facility kinds highlight mismatched assignments independently", () => {
  const roomKinds = ["control_center", "trade_post", "factory", "power_plant", "dormitory", "office", "meeting_room", "workshop", "training_room", "recycling_station"] as const;
  const prefixes = ["control", "trade", "manu", "power", "dorm", "hire", "meet", "workshop", "train", "recycle"];
  const catalog = prefixes.map(prefix => ({ name: prefix, buildingSkills: [{ id: `${prefix}_skill`, index: 0, elite: 0, level: 1 }] }));
  const rooms = roomKinds.map((kind, index) => ({ id: `room-${index}`, kind, level: 3 }));
  const invalid = operatorsWithoutRoomSkills(catalog, rooms);
  for (const [index, room] of rooms.entries()) {
    assert.equal(invalid.get(room.id)?.has(prefixes[index]!), false);
    assert.equal(invalid.get(room.id)?.size, room.kind === "dormitory" ? 0 : prefixes.length - 1);
  }
});

test("dormitories never highlight anyone, including operators without unlocked skills", () => {
  const catalog = [{ name: "No skills", buildingSkills: [] }, { name: "Locked", buildingSkills: [{ id: "dorm_recover_000", index: 0, elite: 2, level: 1 }] }];
  const invalid = operatorsWithoutRoomSkills(catalog, [{ id: "dorm", kind: "dormitory", level: 5 }, { id: "meeting", kind: "meeting_room", level: 3 }], new Map([["Locked", { elite: 0, level: 1 }]]));
  assert.equal(invalid.get("dorm")?.size, 0);
  assert.equal(invalid.get("meeting")?.size, 2);
});

test("Silence is highlighted in reception even when the layout includes a factory", () => {
  const invalid = operatorsWithoutRoomSkills(OPERATOR_CATALOG, [
    { id: "reception", kind: "meeting_room", level: 3 },
    { id: "factory", kind: "factory", level: 3 },
    { id: "recycling", kind: "recycling_station", level: 3 },
  ]);
  assert.equal(invalid.get("reception")?.has("赫默"), true);
  assert.equal(invalid.get("factory")?.has("赫默"), false);
  assert.equal(invalid.get("recycling")?.has("旅骨"), false);
  assert.equal(invalid.get("reception")?.has("旅骨"), true);
});

test("per-room checks preserve skill unlock requirements across different rooms", () => {
  const catalog = [{ name: "Operator", buildingSkills: [
    { id: "manu_spd_000", index: 0, elite: 0, level: 1 },
    { id: "meet_spd_000", index: 1, elite: 2, level: 1 },
  ] }];
  const rooms = [{ id: "meeting", kind: "meeting_room" as const, level: 3 }, { id: "factory", kind: "factory" as const, level: 3 }];
  const locked = operatorsWithoutRoomSkills(catalog, rooms, new Map([["Operator", { elite: 1, level: 80 }]]));
  assert.equal(locked.get("meeting")?.has("Operator"), true);
  assert.equal(locked.get("factory")?.has("Operator"), false);
  const unlocked = operatorsWithoutRoomSkills(catalog, rooms, new Map([["Operator", { elite: 2, level: 1 }]]));
  assert.equal(unlocked.get("meeting")?.has("Operator"), false);
});

test("layout highlighting matches room categories, not complete skill families", () => {
  const skill = (id: string) => ({ id, index: 0, elite: 0, level: 1 });
  const catalog = [
    { name: "Factory", buildingSkills: [skill("manu_spd_001")] },
    { name: "Training", buildingSkills: [skill("train_spd&profession_020")] },
    { name: "Dorm", buildingSkills: [skill("dorm_recover_001")] },
    { name: "Both", buildingSkills: [skill("manu_prod_001"), skill("train_spd_001")] },
    { name: "No skills", buildingSkills: [] },
  ];
  assert.deepEqual([...operatorsWithoutLayoutSkills(catalog, [{ id: "factory_1", kind: "factory", level: 3 }])], ["Training", "Dorm", "No skills"]);
  assert.deepEqual([...operatorsWithoutLayoutSkills(catalog, [{ id: "training_room", kind: "training_room", level: 3 }])], ["Factory", "Dorm", "No skills"]);
  assert.deepEqual([...operatorsWithoutLayoutSkills(catalog, [{ id: "dorm_1", kind: "dormitory", level: 3 }])], ["Factory", "Training", "Both", "No skills"]);
});

test("layout highlighting ignores skills that the operator has not unlocked", () => {
  const catalog = [{
    name: "Factory",
    buildingSkills: [{ id: "manu_spd_001", index: 0, elite: 1, level: 1 }],
  }];
  const rooms = [{ id: "factory_1", kind: "factory" as const, level: 3 }];
  assert.deepEqual([...operatorsWithoutLayoutSkills(catalog, rooms, new Map([["Factory", { elite: 0, level: 30 }]]))], ["Factory"]);
  assert.deepEqual([...operatorsWithoutLayoutSkills(catalog, rooms, new Map([["Factory", { elite: 1, level: 1 }]]))], []);
});
