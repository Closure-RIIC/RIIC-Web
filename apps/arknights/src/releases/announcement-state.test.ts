import assert from "node:assert/strict";
import test from "node:test";
import { isReleaseUnread, readSeenRelease, releaseSeenKey, rememberRelease, RELEASE_SEEN_KEY } from "./announcement-state.ts";
import { releaseHistory } from "./history.ts";
import { latestRelease } from "./latest.ts";

test("first visit and newer releases are unread; repeats and rollbacks are not", () => {
  assert.equal(isReleaseUnread("0.6.0", null), true);
  assert.equal(isReleaseUnread("0.6.0", "0.5.1"), true);
  assert.equal(isReleaseUnread("0.6.0", "0.6.0"), false);
  assert.equal(isReleaseUnread("0.6.0", "0.7.0"), false);
  assert.equal(isReleaseUnread("0.10.0", "0.9.0"), true);
  assert.equal(isReleaseUnread("1.0.0", "0.99.99"), true);
  assert.equal(isReleaseUnread("0.6.1", "0.6.0"), true);
});

test("corrupt previous records recover, invalid current versions never announce", () => {
  for (const value of ["", "garbage", "{", "0.6", "0.6.0-beta", "00.6.0", "0.6.-1", "999999999999999999999.0.0"]) {
    assert.equal(isReleaseUnread("0.6.0", value), true, value);
    assert.equal(isReleaseUnread(value, null), false, value);
  }
});

test("acknowledgement touches only the release key and preserves newer acknowledgements", () => {
  const values = new Map([["box", "original"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  rememberRelease(storage, "0.6.0");
  assert.equal(readSeenRelease(storage), "0.6.0");
  rememberRelease(storage, "0.5.1");
  assert.equal(values.get(RELEASE_SEEN_KEY), "0.6.0");
  rememberRelease(storage, "0.7.0");
  assert.equal(readSeenRelease(storage), "0.7.0");
  assert.equal(values.get("box"), "original");
  assert.equal(values.size, 2);
});

test("the one-time announcement revision ignores old production markers then stays seen", () => {
  const values = new Map([["riic-release-seen-v2:production", "0.6.1"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const activeKey = releaseSeenKey("production");
  assert.equal(activeKey, "riic-release-seen-v3:production");
  assert.equal(releaseSeenKey("development"), "riic-release-seen-v2:development");
  assert.equal(releaseSeenKey("local"), "riic-release-seen-v2:local");
  assert.equal(isReleaseUnread("0.6.1", readSeenRelease(storage, activeKey)), true);
  rememberRelease(storage, "0.6.1", activeKey);
  assert.equal(isReleaseUnread("0.6.1", readSeenRelease(storage, activeKey)), false);
  assert.equal(values.get("riic-release-seen-v2:production"), "0.6.1");
});

test("unavailable or full browser storage does not throw", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readSeenRelease(blocked), null);
  assert.doesNotThrow(() => rememberRelease(blocked, "0.6.0"));
  assert.doesNotThrow(() => rememberRelease({ getItem: () => null, setItem: blocked.setItem }, "0.6.0"));
});

test("page and popup use the same latest release, with valid, unique, descending bilingual history", () => {
  assert.equal(releaseHistory[0], latestRelease);
  assert.equal(new Set(releaseHistory.map((release) => release.version)).size, releaseHistory.length);
  for (const [index, release] of releaseHistory.entries()) {
    assert.equal(isReleaseUnread(release.version, null), true);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Number.isNaN(Date.parse(release.date)), false);
    assert.ok(release.title.zh && release.title.en);
    assert.ok(release.sections.length);
    assert.equal(new Set(release.sections.map((section) => section.kind)).size, release.sections.length);
    for (const section of release.sections) {
      assert.ok(section.items.length);
      for (const item of section.items) assert.ok(item.zh.trim() && item.en.trim());
    }
    const previous = releaseHistory[index - 1];
    if (previous) assert.equal(isReleaseUnread(previous.version, release.version), true);
  }
});
