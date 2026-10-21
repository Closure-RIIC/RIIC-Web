import { APIError, createAuthMiddleware } from "better-auth/api";

import { isStrongPassword, PASSWORD_STRENGTH_ERROR } from "../../password-strength.ts";

const PASSWORD_FIELDS = new Map([
  ["/sign-up/email", "password"],
  ["/reset-password", "newPassword"],
  ["/change-password", "newPassword"],
  ["/email-otp/reset-password", "password"],
  ["/admin/create-user", "password"],
  ["/admin/set-user-password", "newPassword"],
]);

export const passwordStrengthHook = createAuthMiddleware(async (context) => {
  const passwordField = PASSWORD_FIELDS.get(context.path);
  if (!passwordField) return;

  const body = context.body;
  if (!body || typeof body !== "object") return;
  const password = (body as Record<string, unknown>)[passwordField];
  if (typeof password === "string" && !isStrongPassword(password)) {
    throw new APIError("BAD_REQUEST", { message: PASSWORD_STRENGTH_ERROR });
  }
});
