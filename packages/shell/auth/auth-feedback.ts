export type AuthFailure =
  | "invalidCredentials" | "invalidEmail" | "unverifiedEmail" | "existingAccount"
  | "invalidCode" | "expiredCode" | "codeAttempts" | "expiredReset"
  | "weakPassword" | "rateLimited" | "network" | "unavailable";

const failureCodes: Record<string, AuthFailure> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_PASSWORD: "invalidCredentials",
  USER_NOT_FOUND: "invalidCredentials",
  INVALID_EMAIL: "invalidEmail",
  EMAIL_NOT_VERIFIED: "unverifiedEmail",
  USER_ALREADY_EXISTS: "existingAccount",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "existingAccount",
  INVALID_OTP: "invalidCode",
  OTP_EXPIRED: "expiredCode",
  TOO_MANY_ATTEMPTS: "codeAttempts",
  INVALID_TOKEN: "expiredReset",
  TOKEN_EXPIRED: "expiredReset",
  PASSWORD_TOO_SHORT: "weakPassword",
  PASSWORD_TOO_LONG: "weakPassword",
  PASSWORD_TOO_WEAK: "weakPassword",
  TOO_MANY_REQUESTS: "rateLimited",
  RATE_LIMITED: "rateLimited",
};

// Keep server diagnostics out of the form; every failure has localized, actionable copy.
export function authFailure(error: unknown): AuthFailure {
  if (error && typeof error === "object") {
    if ("status" in error && error.status === 429) return "rateLimited";
    if ("code" in error && typeof error.code === "string" && failureCodes[error.code]) return failureCodes[error.code];
    if (error instanceof TypeError || ("name" in error && ["AbortError", "TimeoutError"].includes(String(error.name)))) return "network";
  }
  return "unavailable";
}
