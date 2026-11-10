import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRotationResult } from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { presentRoomEfficiency } from "@riic/arknights-domain/efficiency";
import { autoRotationToRows } from "./auto-rotation-presentation.ts";
import messages from "../../../packages/arknights-domain/messages/zh-CN/efficiency.json" with { type: "json" };
import { registerMessages } from "../../../packages/arknights-domain/src/i18n/localize.ts";

registerMessages("zh-CN", { efficiency: messages });

const layout: BaseBlueprint = {
  template: "243", drone_cap: 250, scenario: {}, rooms: [
    { id: "manu_2", kind: "factory", level: 3, product: { factory: { recipe: "battle_record" } } },
    { id: "trade_1", kind: "trade_post", level: 2, product: { trade: { order: "gold" } } },
    { id: "power_3", kind: "power_plant", level: 3 },
    { id: "dorm_1", kind: "dormitory", level: 5 },
    { id: "recycling_station", kind: "recycle", level: 3 },
    { id: "training_room", kind: "training_room", level: 3 },
  ],
};
const state = { operators: ["阿米娅"], evaluationHours: 32, missingSeats: 0, complete: true };
const result: AutoRotationResult = {
  mode: "auto", hours: [32, 32], complete: false,
  rooms: [
    { roomId: "manu_2", kind: "factory", main: { ...state, productionEfficiency: 1.25 }, backup: { ...state, operators: [], missingSeats: 3, complete: false } },
    { roomId: "trade_1", kind: "trade_post", main: { ...state, productionEfficiency: 2.3 }, backup: state },
    { roomId: "power_3", kind: "power_plant", main: { ...state, powerChargeEfficiency: 0.25 }, backup: state },
    { roomId: "recycling_station", kind: "recycle", main: { ...state, recycleEfficiency: 1.82 }, backup: state },
  ], dormSupport: [{ roomId: "dorm_1", operators: ["杜林"] }],
  fiammetta: null, warnings: [], durationMs: 1, diagnosticId: "queue-test",
};

test("maps independent queues by room ID and reuses layout metadata without mutating results", () => {
  const before = structuredClone(result);
  const main = autoRotationToRows(result, layout, "main");
  const backup = autoRotationToRows(result, layout, "backup");
  const factory = main.find(row => row.roomId === "manu_2")!;
  assert.deepEqual(factory.operators, ["阿米娅"]);
  assert.equal(factory.operatorSlots[0]?.name, "阿米娅");
  assert.match(factory.operatorSlots[0]?.portrait ?? "", /amiya/);
  assert.ok(factory.operatorSlots[0]?.profession);
  assert.deepEqual(factory.roomProduct, { factory: { recipe: "battle_record" } });
  assert.equal(factory.level, 3);
  const backupFactory = backup.find(row => row.roomId === "manu_2")!;
  assert.deepEqual(backupFactory.operators, []);
  assert.equal(backupFactory.suspicious, true);
  assert.equal(factory.suspicious, false);
  for (const rows of [main, backup]) {
    assert.equal(rows.length, layout.rooms.length);
    assert.deepEqual(rows.find(row => row.roomId === "dorm_1")?.operators, ["杜林"]);
    assert.equal(rows.find(row => row.roomId === "training_room")?.suspicious, false);
  }
  main[0].operators.push("测试修改");
  assert.deepEqual(result, before);
});

test("shared efficiency UI preserves production and power units and omits unsupported breakdowns", () => {
  const rows = autoRotationToRows(result, layout, "main");
  const presentation = (id: string) => {
    const row = rows.find(row => row.roomId === id)!;
    return presentRoomEfficiency(row.group, row.efficiency);
  };
  assert.equal(presentation("manu_2")?.primaryValue, "125%");
  assert.equal(presentation("trade_1")?.primaryValue, "230%");
  assert.equal(presentation("power_3")?.primaryValue, "25%");
  assert.deepEqual(rows.find(row => row.roomId === "manu_2")?.efficiency, { final_efficiency: 1.25 });
  assert.equal(presentation("recycling_station"), null);
  assert.equal(rows.find(row => row.roomId === "training_room")?.efficiency, undefined);
});
