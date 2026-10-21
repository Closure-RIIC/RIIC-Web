import { Resend } from "resend";
import { sendAliyunEmail, type AuthEmailMessage } from "./aliyun-email.ts";
import type { AuthEmailConfig } from "./email-config.ts";

const CAPACITY_ERRORS = new Set(["monthly_quota_exceeded", "daily_quota_exceeded", "rate_limit_exceeded"]);

export async function deliverAuthEmail(message: AuthEmailMessage, config: AuthEmailConfig): Promise<void> {
  if (config.provider === "aliyun") {
    if (!config.aliyun) throw new Error("Aliyun authentication email is not configured.");
    await sendAliyunEmail(message, config.aliyun);
    return;
  }
  let result;
  try {
    result = await new Resend(config.resendApiKey).emails.send(message);
  } catch {
    throw new Error("Resend authentication email request failed; delivery status is unknown.");
  }
  if (!result.error && result.data?.id) return;
  // Only explicit capacity rejections are safe to send through another provider.
  // Timeouts and 5xx may occur after acceptance; never double-send those.
  const reason = result.error?.name;
  if (reason && CAPACITY_ERRORS.has(reason) && config.aliyun) {
    console.warn(`[auth-email] Resend ${reason}; using aliyun.`);
    await sendAliyunEmail(message, config.aliyun);
    return;
  }
  if (reason && CAPACITY_ERRORS.has(reason)) {
    throw new Error(`Resend authentication email capacity exceeded (${reason}); fallback is not configured.`);
  }
  throw new Error("Resend authentication email failed or was not acknowledged; no automatic fallback was attempted.");
}
