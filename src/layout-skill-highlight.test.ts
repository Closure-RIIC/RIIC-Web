import assert from "node:assert/strict";
import test from "node:test";
import { operatorsWithoutLayoutSkills } from "./layout-skill-highlight.ts";

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
