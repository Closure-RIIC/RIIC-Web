import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_EXCLUSIVE_PAIRS,
  PROFILE_LIMITS,
  PROFILE_TAG_IDS,
  PROFILE_VOCAB,
  addProfileFact,
  applyProfileUpdate,
  describeUserProfile,
  detectProfileConflicts,
  effectiveTagScore,
  emptyUserProfile,
  hitProfileTag,
  liveProfileFacts,
  normalizeUserProfile,
  profileFactRelation,
  renderProfileBrief,
  resolveProfileConflict,
  setProfileConstraint,
} from "./core.ts";
import { USER_PROFILE_RULES, formatUserProfilePrompt } from "./prompt.ts";

const T0 = new Date("2026-11-11T08:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

test("constraints accept only documented values and record rejections", () => {
  const profile = emptyUserProfile();
  for (const [key, value] of [["dailyLoginMax", 999], ["dailyLoginMax", true], ["sessionMinutes", 1], ["device", "toaster"], ["shiftChangeAllowed", "maybe"], ["unknownKey", 1]] as const) {
    assert.equal(setProfileConstraint(profile, key, value, T0), false, `${key}=${String(value)}`);
  }
  assert.deepEqual(profile.constraints, {});
  assert.equal(profile.violations.length, 6);
  assert.equal(setProfileConstraint(profile, "dailyLoginMax", 2, T0), true);
  assert.equal(setProfileConstraint(profile, "device", "pc", T0), true);
  assert.deepEqual(profile.constraints, { dailyLoginMax: 2, device: "pc" });
});

test("repeated tag hits add evidence instead of new entries, and unknown ids are dropped", () => {
  const profile = emptyUserProfile();
  for (let i = 0; i < 3; i += 1) hitProfileTag(profile, "no_shift_change", "stated", T0);
  assert.equal(profile.tags.length, 1);
  assert.equal(profile.tags[0].hits, 3);
  assert.equal(hitProfileTag(profile, "not_a_real_tag", "stated", T0), null);
  assert.equal(profile.tags.length, 1);
  assert.equal(profile.violations.at(-1)?.reason, "unknown_tag");
});

test("tag scores decay weekly and eviction keeps the strongest tags within caps", () => {
  const profile = emptyUserProfile();
  hitProfileTag(profile, "eff_max", "stated", T0);
  assert.ok(Math.abs(effectiveTagScore(profile.tags[0], days(7)) - PROFILE_LIMITS.decayPerWeek) < 1e-9);
  for (const id of PROFILE_TAG_IDS) hitProfileTag(profile, id, "stated", T0);
  assert.ok(profile.tags.length <= PROFILE_LIMITS.globalCap, `${profile.tags.length} tags`);
  for (const [group, vocab] of Object.entries(PROFILE_VOCAB)) {
    const count = profile.tags.filter((tag) => tag.id in vocab).length;
    assert.ok(count <= PROFILE_LIMITS.groupCap, `${group} has ${count}`);
  }
  // eff_max was hit twice, so it outranks single-hit tags and must survive eviction.
  assert.ok(profile.tags.some((tag) => tag.id === "eff_max"));
});

test("a preference stated once stays in the brief until it decays (not filtered at birth)", () => {
  const profile = emptyUserProfile();
  hitProfileTag(profile, "originite_keep", "stated", T0);
  assert.match(renderProfileBrief(profile, new Date(T0.getTime() + 60_000)).text, /绝不碎石/);
  assert.doesNotMatch(renderProfileBrief(profile, days(7 * 5)).text, /绝不碎石/);
});

test("facts: same thing adds evidence, a negated restatement retires the old fact", () => {
  const profile = emptyUserProfile();
  const a = addProfileFact(profile, "不喜欢每天换班，觉得麻烦", "stated", T0)!;
  const b = addProfileFact(profile, "不喜欢每天换班", "stated", T0)!;
  assert.equal(a, b);
  assert.equal(a.hits, 2);

  const old = addProfileFact(profile, "不喜欢肉鸽", "stated", T0)!;
  const fresh = addProfileFact(profile, "喜欢肉鸽", "stated", days(1))!;
  assert.equal(old.hits, 1, "the opposite statement must not add evidence to the old fact");
  assert.equal(old.supersededBy, fresh.id);
  assert.ok(liveProfileFacts(profile).includes(fresh));
  assert.ok(profile.facts.includes(old), "retired facts stay on file");

  addProfileFact(profile, "玩", "stated", T0);
  addProfileFact(profile, "只玩肉鸽", "stated", T0);
  const live = liveProfileFacts(profile).map((fact) => fact.text);
  assert.ok(live.includes("玩") && live.includes("只玩肉鸽"), "short facts must not swallow others");
  assert.equal(profileFactRelation("特别想推主线", "想推主线"), "same");
});

test("facts reject numbers and over-long text", () => {
  const profile = emptyUserProfile();
  assert.equal(addProfileFact(profile, "日产出 42000 龙门币", "stated", T0), null);
  assert.equal(addProfileFact(profile, "贸易站效率 35%", "stated", T0), null);
  assert.equal(addProfileFact(profile, "很".repeat(61), "stated", T0), null);
  assert.deepEqual(profile.violations.map((item) => item.reason), ["numeric_fact", "numeric_fact", "fact_too_long"]);
});

test("stated vs behavior conflicts are detected once, asked once per window, and resolved by demotion", () => {
  const profile = emptyUserProfile();
  hitProfileTag(profile, "eff_max", "stated", T0);
  for (let i = 0; i < 3; i += 1) hitProfileTag(profile, "eff_lowop", "behavior", T0);
  const found = detectProfileConflicts(profile, T0);
  assert.equal(found.length, 1);
  assert.equal(detectProfileConflicts(profile, days(1)).length, 0, "no duplicate open conflict");

  const first = renderProfileBrief(profile, T0);
  assert.equal(first.conflict?.mode, "ask");
  assert.equal(first.changed, true);
  const followUp = renderProfileBrief(profile, new Date(T0.getTime() + 10 * 60_000));
  assert.equal(followUp.conflict?.mode, "awaiting", "the next turn still sees the id so the answer can be recorded");
  assert.equal(followUp.changed, false);
  assert.equal(renderProfileBrief(profile, days(3)).conflict, null, "not re-asked within 14 days");
  assert.equal(renderProfileBrief(profile, days(15)).conflict?.mode, "ask");

  assert.equal(resolveProfileConflict(profile, found[0].id, "behavior", days(15)), true);
  const now = days(15);
  const lowop = profile.tags.find((tag) => tag.id === "eff_lowop")!;
  const max = profile.tags.find((tag) => tag.id === "eff_max")!;
  assert.ok(effectiveTagScore(lowop, now) > effectiveTagScore(max, now));
  assert.ok(profile.tags.includes(max), "the losing side is demoted, not deleted");
  assert.equal(resolveProfileConflict(profile, found[0].id, "stated", now), false);
});

test("every exclusive pair sits inside one vocabulary group", () => {
  const groupOf = (id: string) => Object.entries(PROFILE_VOCAB).find(([, vocab]) => id in vocab)?.[0];
  for (const [a, b] of PROFILE_EXCLUSIVE_PAIRS) {
    assert.ok(groupOf(a), `${a} is not in the vocabulary`);
    assert.equal(groupOf(a), groupOf(b), `${a}/${b}`);
  }
  assert.equal(PROFILE_EXCLUSIVE_PAIRS.length, 14);
});

test("brief orders constraints first and never leaks internal fields", () => {
  const profile = emptyUserProfile();
  setProfileConstraint(profile, "dailyLoginMax", 2, T0);
  setProfileConstraint(profile, "shiftChangeAllowed", false, T0);
  hitProfileTag(profile, "no_shift_change", "stated", T0);
  addProfileFact(profile, "主要玩肉鸽，基建随缘", "stated", T0);
  const retired = addProfileFact(profile, "不喜欢肉鸽", "stated", T0)!;
  addProfileFact(profile, "喜欢肉鸽", "stated", T0);
  const brief = renderProfileBrief(profile, T0);
  const lines = brief.text.split("\n");
  assert.match(lines[0], /^硬约束.*每天最多登录次数：2.*不接受换班/);
  assert.match(brief.text, /尚未确认的约束：.*单次可用分钟数/);
  assert.match(brief.text, /已知偏好.*不接受频繁换班/);
  assert.doesNotMatch(brief.text, new RegExp(retired.text));
  assert.doesNotMatch(brief.text, /hits|score|statedHits|inferredHits|supersed|f_00/);
  assert.equal(brief.empty, false);
});

test("applyProfileUpdate reports saved and rejected items without throwing", () => {
  const profile = emptyUserProfile();
  const result = applyProfileUpdate(profile, {
    constraints: { dailyLoginMax: 2, sessionMinutes: 999 },
    preferences: [{ id: "originite_keep" }, { id: "made_up" }],
    facts: [{ text: "主要在电脑上玩" }, { text: "每天产 30000 龙门币" }],
  }, T0);
  assert.deepEqual(result.saved.constraints, ["dailyLoginMax"]);
  assert.deepEqual(result.saved.preferences, ["绝不碎石"]);
  assert.deepEqual(result.saved.facts, ["主要在电脑上玩"]);
  assert.equal(result.rejected.length, 3);
  assert.equal(result.changed, true);
  const view = describeUserProfile(profile, T0);
  assert.deepEqual(view.constraints, ["每天最多登录次数：2"]);
  assert.deepEqual(view.preferences, ["绝不碎石"]);
  assert.deepEqual(view.facts, ["主要在电脑上玩"]);
});

test("normalize drops unknown versions and invalid stored values instead of injecting them", () => {
  assert.deepEqual(normalizeUserProfile({ schemaVersion: 99, constraints: { dailyLoginMax: 2 } }), emptyUserProfile());
  assert.deepEqual(normalizeUserProfile(null), emptyUserProfile());
  const restored = normalizeUserProfile({
    ...emptyUserProfile(),
    constraints: { dailyLoginMax: 999, device: "pc" },
    tags: [{ id: "bogus", score: 1, hits: 1, statedHits: 1, inferredHits: 0, at: T0.toISOString() }],
  });
  assert.deepEqual(restored.constraints, { device: "pc" });
  assert.deepEqual(restored.tags, []);
});

test("the injected prompt always carries the rules, even for an empty profile", () => {
  const prompt = formatUserProfilePrompt(renderProfileBrief(emptyUserProfile(), T0));
  assert.ok(prompt.includes(USER_PROFILE_RULES));
  assert.match(prompt, /目前还没有记录任何画像/);
  assert.match(prompt, /update_user_profile/);
});
