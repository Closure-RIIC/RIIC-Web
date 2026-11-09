import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

import type { BaseBlueprint } from "@riic/arknights-domain/types";
import type { NativeEvalRequestV1 } from "./client.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

test("shipped WASM evaluates recycle rooms with their IDs, levels and assignments intact", async (context) => {
  const publicRoot = new URL("../../../public/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("wasm/infra-eval-manifest.json", publicRoot), "utf8"));
  const glueUrl = new URL(manifest.glueUrl.slice(1), publicRoot);
  const glueSource = readFileSync(glueUrl, "utf8");
  const fetched: string[] = [];
  const blobs: Blob[] = [];

  // Adapt browser transport only: the client loads the checked-in manifest,
  // glue and WASM, and calls the real evaluate_v1 implementation.
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.ok(["/wasm/infra-eval-manifest.json", manifest.glueUrl, manifest.wasmUrl].includes(url), url);
    fetched.push(url);
    return new Response(readFileSync(new URL(url.slice(1), publicRoot)), {
      headers: { "Content-Type": url.endsWith(".wasm") ? "application/wasm" : url.endsWith(".json") ? "application/json" : "text/javascript" },
    });
  });
  context.mock.method(URL, "createObjectURL", (blob: Blob) => {
    blobs.push(blob);
    return glueUrl.href;
  });
  context.mock.method(URL, "revokeObjectURL", (url: string) => assert.equal(url, glueUrl.href));
  const { evaluateNativeSchedule } = await import("./client.ts");

  for (const level of [1, 2, 3]) {
    const layout = JSON.parse(readFileSync(new URL("../../../../../packages/arknights-domain/src/layouts/243.json", import.meta.url), "utf8")) as BaseBlueprint;
    const recycle = layout.rooms.find(room => room.kind === "recycle")!;
    recycle.id = `custom-recycle-${level}`;
    recycle.level = level;
    const request: NativeEvalRequestV1 = {
      schema_version: 1,
      layout,
      scheduled_operators: [{ id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 1, rarity: 5 }],
      shifts: [8, 16].map(duration_hours => ({
        duration_hours,
        rooms: layout.rooms.map(room => ({ room_id: room.id, operators: duration_hours === 8 && room.id === recycle.id ? [{ name: "阿米娅", work_mood: 24 }] : [] })),
      })),
    };
    const before = structuredClone(request);
    freeze(request);

    const response = await evaluateNativeSchedule(request);
    assert.equal(response.status, "ok");
    assert.equal(response.engine.api, manifest.api);
    assert.equal(response.engine.ruleset, manifest.ruleset);
    assert.deepEqual(response.shifts.map(shift => shift.duration_hours), [8, 16]);
    for (const shift of response.shifts) {
      const result = shift.rooms.find(room => room.room_id === recycle.id);
      assert.ok(result, `recycle level ${level} remains in the result`);
      assert.equal(result.level, level);
      assert.equal(result.settlement_status, "evaluated");
      assert.equal(result.facility, "recycle");
      assert.equal(shift.rooms.find(room => room.room_id === "trade_1")?.facility, "trade_post");
    }
    // The first shift has one operator and the second is empty. Check the real
    // engine's staffing increment as well as the level-three base increase.
    assert.deepEqual(response.shifts.map(shift => shift.rooms.find(room => room.room_id === recycle.id)!.display_base_basis_points),
      level === 3 ? [1210, 1200] : [1010, 1000]);
    assert.deepEqual(request, before);

    if (level === 3) {
      await assert.rejects(evaluateNativeSchedule({ ...request, layout: { ...layout, rooms: layout.rooms.map(room =>
        room.id === recycle.id ? { ...room, kind: "unsupported" } : room,
      ) } }), /unknown room kind: unsupported/);
      assert.deepEqual(request, before);
    }
  }

  assert.deepEqual(fetched, ["/wasm/infra-eval-manifest.json", manifest.glueUrl, manifest.wasmUrl]);
  assert.equal(blobs.length, 1);
  assert.equal(await blobs[0]!.text(), glueSource);
});
