import assert from "node:assert/strict";
import test from "node:test";

import { parseShiftFile } from "./shift-parser.ts";

type ParsedShift = {
  index: number;
  scores: { room_lines: Array<Record<string, unknown>> };
};

function requireShift(value: unknown): ParsedShift {
  assert.ok(value && typeof value === "object" && "scores" in value);
  return value as ParsedShift;
}

test("keeps the versioned score structure", () => {
  const shift = { scores: { room_lines: [{ room_id: "trade_1", trade_pct: 120 }] } };
  assert.deepEqual(parseShiftFile(JSON.stringify(shift), 0), shift);
});

test("normalizes legacy rooms efficiency", () => {
  const parsed = requireShift(parseShiftFile(JSON.stringify({ rooms: [{ room_id: "manu_1", efficiency: { manu_prod_total: 145 } }] }), 1));
  assert.equal(parsed.index, 1);
  assert.equal(parsed.scores.room_lines[0].manu_prod_total, 145);
});

test("recovers numeric efficiency from damaged JSON text", () => {
  const raw = '{"rooms":[{"room_id":"trade_1","operators":[{"name":"坏字符}],"efficiency":{"trade_pct":200}}]}';
  const parsed = requireShift(parseShiftFile(raw, 2));
  assert.equal(parsed.scores.room_lines[0].trade_pct, 200);
});

test("rejects valid JSON that is not a shift", () => {
  assert.equal(parseShiftFile("{}", 0), null);
  assert.equal(parseShiftFile("42", 0), null);
  assert.equal(parseShiftFile('{"scores":{}}', 0), null);
});
