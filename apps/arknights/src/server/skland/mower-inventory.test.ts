import assert from "node:assert/strict";
import test from "node:test";

import { mergeInventoryItems, parseMowerDepotResponse } from "./mower-inventory.ts";

test("parses mower's mapped inventory payload", () => {
  assert.deepEqual(
    parseMowerDepotResponse([
      {},
      JSON.stringify({ "4003": 36000, "4002": 127 }),
      "2026-09-21 15:00:00",
    ]),
    [
      { id: "4002", count: 127 },
      { id: "4003", count: 36000 },
    ],
  );
});

test("does not let zero Skland values erase positive mower values", () => {
  assert.deepEqual(
    mergeInventoryItems(
      [{ id: "4003", count: 0 }, { id: "4001", count: 100 }],
      [{ id: "4003", count: 36000 }, { id: "4002", count: 127 }],
    ),
    [
      { id: "4003", count: 36000 },
      { id: "4002", count: 127 },
      { id: "4001", count: 100 },
    ],
  );
});
