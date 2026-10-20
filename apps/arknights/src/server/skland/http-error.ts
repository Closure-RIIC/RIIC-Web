import type { AppErrorCode } from "../../types.ts";
import type { SklandServiceErrorCode } from "./upstream-error.ts";

export function publicCodeForSklandServiceError(code: SklandServiceErrorCode): AppErrorCode {
  if (code === "AUTH_EXPIRED") return "AIC-AUTH-2001";
  if (code === "RATE_LIMITED") return "AIC-RATE-6001";
  if (code === "INSECURE") return "AIC-AUTH-2002";
  if (code === "NOT_CONFIGURED") return "AIC-AUTH-2003";
  if (code === "UNAVAILABLE") return "AIC-SYS-5000";
  return "AIC-REQ-1001";
}
