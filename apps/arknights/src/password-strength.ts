const COMMON_PASSWORD = /^(?:password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|abc123|111111|123123|123456)/i;
const REPEATED_CHARACTER = /(.)\1{5,}/u;

const PASSWORD_RULES = [
  { id: "length", label: "至少 8 个字符", test: (value: string) => value.length >= 8 },
  { id: "letter", label: "包含字母", test: (value: string) => /[a-z]/i.test(value) },
  { id: "digit", label: "包含数字", test: (value: string) => /\d/.test(value) },
  { id: "variety", label: "大写、小写、特殊字符至少两种", test: (value: string) => (/[a-z]/.test(value) && /[A-Z]/.test(value)) || ((/[a-z]/i.test(value)) && /[^a-z0-9\s]/i.test(value)) },
] as const;

export const PASSWORD_STRENGTH_ERROR = "密码强度不足：至少 8 位，包含数字，且大写字母、小写字母、特殊字符中至少包含两种；避免常见密码和连续 6 个相同字符。";

export function evaluatePasswordStrength(value: string) {
  const rules = PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(value) }));
  const passed = rules.filter((rule) => rule.met).length;
  const guessable = value.length > 0 && (
    COMMON_PASSWORD.test(value)
    || REPEATED_CHARACTER.test(value)
  );
  const score = value.length === 0 ? 0 : guessable ? 1 : Math.min(PASSWORD_RULES.length, Math.max(1, passed));

  return {
    rules,
    guessable,
    score,
    strong: passed === PASSWORD_RULES.length && !guessable,
  };
}

export function isStrongPassword(value: string): boolean {
  return evaluatePasswordStrength(value).strong;
}
