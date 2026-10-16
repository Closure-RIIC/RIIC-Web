import assert from "node:assert/strict";
import test from "node:test";
import { attendanceFromStatus, shanghaiAttendanceDate } from "./skland-attendance.ts";

test("attendance day changes at Shanghai midnight, independently of the host timezone", () => {
  assert.equal(shanghaiAttendanceDate(Date.parse("2026-10-15T15:59:59Z")), "2026-10-15");
  assert.equal(shanghaiAttendanceDate(Date.parse("2026-10-15T16:00:00Z")), "2026-10-16");
  const status = { currentTs: String(Date.parse("2026-10-15T16:01:00Z") / 1000), records: [{ ts: String(Date.parse("2026-10-15T16:00:30Z") / 1000), resourceId: "lmd", count: 500 }], resourceInfoMap: { lmd: { name: "龙门币" } } };
  const view = attendanceFromStatus("uid", status);
  assert.deepEqual(view, { uid: "uid", date: "2026-10-16", hasToday: true, signedNow: false, awards: [{ name: "龙门币", count: 500 }] });
  assert.equal(attendanceFromStatus("uid", { ...status, currentTs: String(Date.parse("2026-10-16T16:01:00Z") / 1000) }).hasToday, false);
  assert.throws(() => attendanceFromStatus("uid", { ...status, currentTs: "invalid" }), /Invalid/);
});
