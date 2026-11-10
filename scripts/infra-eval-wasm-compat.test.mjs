import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { toNativeEvalLayout } from "../apps/arknights/src/lib/infra-eval/layout.ts";

const publicRoot = new URL("../apps/arknights/public/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("wasm/infra-eval-manifest.json", publicRoot), "utf8"));
const bindings = await import(new URL(manifest.glueUrl.slice(1), publicRoot));
bindings.initSync({ module: await readFile(new URL(manifest.wasmUrl.slice(1), publicRoot)) });
const operator = { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 };

function requestFor(layout) {
  return {
    schema_version: 1,
    layout,
    scheduled_operators: [operator],
    shifts: ["trade_1", "recycling_station"].map(roomId => ({
      duration_hours: 12,
      rooms: layout.rooms.map(room => ({ room_id: room.id, operators: room.id === roomId ? [{ name: operator.name }] : [] })),
    })),
  };
}

for (const template of ["153", "243", "252", "333", "342"]) {
  const original = JSON.parse(await readFile(new URL(`../packages/arknights-domain/src/layouts/${template}.json`, import.meta.url), "utf8"));
  for (const override of [false, true]) {
    test(`${template} retains recycling and assignments in the shipped WASM${override ? " with a shift product override" : ""}`, () => {
      const layout = globalThis.structuredClone(original);
      if (override) layout.rooms.find(room => room.id === "manu_1").product = { factory: { recipe: "battle_record" } };
      const request = requestFor(layout);
      const snapshot = globalThis.structuredClone(request);
      const adapted = { ...request, layout: toNativeEvalLayout(request.layout) };
      const response = JSON.parse(bindings.evaluate_v1(JSON.stringify(adapted)));
      assert.equal(response.status, "ok", JSON.stringify(response.errors));
      assert.deepEqual(response.engine, { api: manifest.api, ruleset: manifest.ruleset });
      assert.equal(response.shifts.length, request.shifts.length);
      for (const shift of response.shifts) {
        assert.deepEqual(shift.rooms.map(room => room.room_id).sort(), layout.rooms.map(room => room.id).sort());
        const recycling = shift.rooms.find(room => room.room_id === "recycling_station");
        assert.equal(recycling.settlement_status, "evaluated");
        assert.equal(recycling.level, layout.rooms.find(room => room.kind === "recycle").level);
      }
      assert.deepEqual(adapted.shifts, snapshot.shifts);
      assert.deepEqual(request, snapshot);
      assert.deepEqual(adapted.layout, { ...layout, rooms: layout.rooms.map(room => room.kind === "recycle" ? { ...room, kind: "recycling_station" } : room) });
    });
  }
}

test("the WASM boundary preserves rejection of unknown room kinds", () => {
  const request = requestFor({ rooms: [{ id: "trade_1", kind: "unknown_room", level: 3 }] });
  const response = JSON.parse(bindings.evaluate_v1(JSON.stringify({ ...request, layout: toNativeEvalLayout(request.layout) })));
  assert.equal(response.status, "error");
  assert.ok(response.errors.some(error => error.code === "INVALID_LAYOUT" && error.message.includes("unknown_room")));
});
