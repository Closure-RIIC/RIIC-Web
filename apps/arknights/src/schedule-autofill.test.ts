import assert from "node:assert/strict";
import test from "node:test";

import { maaRoomAutofill } from "./schedule-autofill.ts";

const partialDorm = {
  group: "dormitory",
  skip: false,
  occupiedSlots: 1,
  capacity: 5,
};

test("propagates an explicit MAA autofill flag", () => {
  assert.equal(maaRoomAutofill(true), true);
  assert.equal(maaRoomAutofill(false), false);
  assert.equal(maaRoomAutofill(undefined), false);
  assert.equal(maaRoomAutofill("true"), false);
});

test("shows AUTO for partial legacy dorms without changing full or skipped rooms", () => {
  assert.equal(maaRoomAutofill(false, partialDorm), false);
  assert.equal(maaRoomAutofill(undefined, partialDorm), true);
  assert.equal(maaRoomAutofill(false, { ...partialDorm, occupiedSlots: 5 }), false);
  assert.equal(maaRoomAutofill(false, { ...partialDorm, skip: true }), false);
  assert.equal(maaRoomAutofill(false, { ...partialDorm, group: "meeting" }), false);
});

test("does not infer autofill when a dorm uses MAA operator candidates", () => {
  assert.equal(maaRoomAutofill(false, { ...partialDorm, candidates: ["杜林"] }), false);
  assert.equal(maaRoomAutofill(undefined, { ...partialDorm, candidates: ["杜林"] }), false);
  assert.equal(maaRoomAutofill(false, { ...partialDorm, candidates: [] }), false);
  assert.equal(maaRoomAutofill(undefined, { ...partialDorm, candidates: [] }), true);
});
