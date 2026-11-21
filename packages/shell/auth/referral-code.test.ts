import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearReferralCode, normalizeReferralCode, readReferralCode, readSignupReferralCode, referralSignupHeaders, rememberReferralCode } from "./referral-code.ts";

const first = "ABCDEF0123456789ABCDEF01";
const second = "0123456789ABCDEF01234567";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { href: "https://riic.example/" },
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  } });
  clearReferralCode();
});
afterEach(() => {
  clearReferralCode();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("only normalized 24-digit hexadecimal invitation codes reach signup headers", () => {
  assert.equal(normalizeReferralCode(` ${first.toLowerCase()} `), first);
  for (const invalid of [null, {}, "", "not-a-code", `${first}\r\nInjected: yes`, `${first}0`, "Z".repeat(24)]) {
    assert.equal(normalizeReferralCode(invalid), null);
  }
  assert.deepEqual(referralSignupHeaders(), {});
  rememberReferralCode(first);
  assert.deepEqual(referralSignupHeaders(), { "x-riic-referral-code": first });
});

test("the last well-formed link replaces an earlier link while an invalid link does not", () => {
  rememberReferralCode(first);
  rememberReferralCode(second.toLowerCase());
  rememberReferralCode("bad-link");
  assert.equal(readReferralCode(), second);
  clearReferralCode();
  assert.equal(readReferralCode(), null);
  assert.deepEqual(referralSignupHeaders(), {});
  assert.equal(values.size, 0);
});

test("signup captures the current landing link before its campaign request completes", () => {
  window.location.href = `https://riic.example/referral?ref=${second.toLowerCase()}`;
  assert.deepEqual(referralSignupHeaders(), { "x-riic-referral-code": second });
  window.location.href = `https://riic.example/other?ref=${first}`;
  assert.deepEqual(referralSignupHeaders(), { "x-riic-referral-code": second });
});

test("the edited signup field overrides both the current link and the stored invitation, including when cleared", () => {
  rememberReferralCode(first);
  window.location.href = `https://riic.example/referral?ref=${second.toLowerCase()}`;
  assert.equal(readSignupReferralCode(), second);
  assert.deepEqual(referralSignupHeaders(` ${first.toLowerCase()} `), {
    "x-riic-referral-code": first, "x-riic-require-referral": "1",
  });
  assert.deepEqual(referralSignupHeaders(""), {});
  assert.deepEqual(referralSignupHeaders("bad-code"), {});
});

test("blocked browser storage preserves referral navigation in memory and can be cleared", () => {
  Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked"); } });
  rememberReferralCode(first);
  assert.deepEqual(referralSignupHeaders(), { "x-riic-referral-code": first });
  clearReferralCode();
  assert.deepEqual(referralSignupHeaders(), {});
});
