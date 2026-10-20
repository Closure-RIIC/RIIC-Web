import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePasswordStrength, isStrongPassword } from "./password-strength.ts";

test("accepts eight-character passwords with a number and two character types", () => {
  for (const password of ["Abcde123", "Axy123!?", "AXY123!?", "axy123!?", "Abc11111!"]) {
    const result = evaluatePasswordStrength(password);
    assert.equal(result.strong, true, password);
    assert.equal(result.score, 4, password);
    assert.equal(result.guessable, false, password);
    assert.equal(result.rules.every((rule) => rule.met), true, password);
  }
});

test("rejects passwords that miss length, a number, or a second character type", () => {
  for (const password of ["Abc123!", "NoNumbersHere!", "abc12345", "ABC12345", "12345!@#", "abc1234 "]) {
    assert.equal(isStrongPassword(password), false, password);
  }
});

test("rejects common passwords and six identical characters in a row", () => {
  for (const password of ["password-123", "Abc111111!", "A1!😀😀😀😀😀😀"]) {
    const result = evaluatePasswordStrength(password);
    assert.equal(result.rules.every((rule) => rule.met), true);
    assert.equal(result.guessable, true);
    assert.equal(result.strong, false);
  }
});

test("allows sequential characters and five identical characters in a row", () => {
  for (const password of ["Abcd-987654", "Xqwer9!z", "Abc11111!"]) {
    assert.equal(isStrongPassword(password), true, password);
  }
});
