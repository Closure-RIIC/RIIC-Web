import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertReleasePublishable, compareReleaseVersions, parseReleaseDraft, parseReleaseMutation } from "./validation.ts";
import { releaseHistory } from "./history.ts";
import { releaseSeenKey, readSeenRelease, rememberRelease } from "./announcement-state.ts";

const valid = {
  version: "0.6.1", date: "2026-09-05", title: { zh: " 更新日志 ", en: "" }, notify: true,
  sections: [{ kind: "added", items: [{ zh: "新功能", en: "" }] }],
};

test("draft validation trims text and allows optional English without interpreting HTML", () => {
  const draft = parseReleaseDraft(valid);
  assert.equal(draft.title.zh, "更新日志");
  assert.equal(draft.title.en, "");
  assert.equal(parseReleaseDraft({ ...valid, title: { zh: "<script>alert(1)</script>" } }).title.zh, "<script>alert(1)</script>");
});

test("draft validation rejects malformed versions, dates, extra fields and excessive content", () => {
  for (const version of ["v0.6.1", "0.6", "00.6.1", "0.6.1-beta", "-1.0.0", "1000000.0.0"]) {
    assert.throws(() => parseReleaseDraft({ ...valid, version }), /版本号/);
  }
  for (const date of ["2026-02-29", "2026-09-31", "2026-9-5", "invalid"]) {
    assert.throws(() => parseReleaseDraft({ ...valid, date }));
  }
  for (const changes of [
    { environment: "production" }, { published: valid }, { notify: "true" }, { sections: [] },
    { title: { zh: "", en: "English only" } }, { title: { zh: "a".repeat(121) } },
    { title: { zh: "bad\u0000text" } }, { sections: [...valid.sections, ...valid.sections] },
    { sections: [{ kind: "added", items: Array.from({ length: 13 }, () => ({ zh: "x" })) }] },
    { sections: [{ kind: "added", items: [{ zh: "x".repeat(501) }] }] },
  ]) assert.throws(() => parseReleaseDraft({ ...valid, ...changes }));
  assert.doesNotThrow(() => parseReleaseDraft({ ...valid, date: "2028-02-29" }));
});

test("publish guards future dates in Shanghai time but drafts can be prepared early", () => {
  const draft = parseReleaseDraft(valid);
  assert.throws(() => assertReleasePublishable(draft, new Date("2026-09-04T15:59:59Z")), /尚未到来/);
  assert.doesNotThrow(() => assertReleasePublishable(draft, new Date("2026-09-04T16:00:00Z")));
  assert.doesNotThrow(() => parseReleaseDraft({ ...valid, date: "2099-01-01" }));
});

test("mutations require a revision and cannot smuggle draft changes into publishing", () => {
  assert.deepEqual(parseReleaseMutation({ action: "publish", revision: 2 }), { action: "publish", revision: 2 });
  assert.equal(parseReleaseMutation({ action: "save", revision: 1, draft: valid }).draft?.title.zh, "更新日志");
  for (const value of [
    { action: "publish", revision: 0 }, { action: "publish", revision: "1" },
    { action: "publish", revision: 1, draft: valid }, { action: "save", revision: 1 },
    { action: "delete", revision: 1, environment: "production" }, { action: "unknown", revision: 1 },
  ]) assert.throws(() => parseReleaseMutation(value));
});

test("versions sort numerically and environment read markers do not overlap", () => {
  assert.deepEqual(["0.9.0", "0.10.0", "1.0.0"].sort((a, b) => compareReleaseVersions(b, a)), ["1.0.0", "0.10.0", "0.9.0"]);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  rememberRelease(storage, "0.7.0", releaseSeenKey("development"));
  assert.equal(readSeenRelease(storage, releaseSeenKey("production")), null);
  assert.equal(readSeenRelease(storage, releaseSeenKey("local")), null);
  rememberRelease(storage, "0.6.0", releaseSeenKey("development"));
  assert.equal(readSeenRelease(storage, releaseSeenKey("development")), "0.7.0");
});

test("bootstrap SQL contains the validated historical fixtures once, not an ongoing fallback", () => {
  const sql = readFileSync(new URL("../../../../drizzle/0015_release_notes.sql", import.meta.url), "utf8");
  const serialized = sql.split("$release_seed$")[1];
  const notes = JSON.parse(serialized);
  assert.deepEqual(notes, releaseHistory.map((note, index) => ({ ...note, notify: index === 0 })));
  for (const note of notes) assert.doesNotThrow(() => parseReleaseDraft(note));
});
