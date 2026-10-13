import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin, emailOTP } from "better-auth/plugins";
import { getDatabase } from "@/server/db";
import { deleteWebsiteAccountPrivateArtifacts } from "./account-deletion";
import { websiteAccountNameDatabaseHooks } from "./account-name-hooks";
import { sendAuthEmail } from "./email";
import { configuredAdminIds, localAuthTrustedOrigins, requireAuthBaseUrl, requireAuthSecret } from "./config";
import { passwordStrengthHook } from "./password-strength-hook";
import { WEBSITE_SESSION_DURATION_SECONDS } from "./session-lifetime";

function createAuth() {
  const baseURL = requireAuthBaseUrl();
  return betterAuth({
    appName: "可露希尔基建终端",
    baseURL,
    trustedOrigins: localAuthTrustedOrigins(baseURL),
    secret: requireAuthSecret(),
    database: drizzleAdapter(getDatabase(), { provider: "pg" }),
    databaseHooks: websiteAccountNameDatabaseHooks,
    hooks: { before: passwordStrengthHook },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => sendAuthEmail({ to: user.email, url, kind: "reset" }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 10 * 60,
    },
    session: {
      expiresIn: WEBSITE_SESSION_DURATION_SECONDS,
    },
    rateLimit: { enabled: true, storage: "database" },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => deleteWebsiteAccountPrivateArtifacts(user.id),
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: ({ email, otp, type }) => {
          if (type !== "email-verification") throw new Error("Only email verification OTP delivery is enabled.");
          return sendAuthEmail({ to: email, code: otp, kind: "verify-code" });
        },
      }),
      admin({ adminUserIds: [...configuredAdminIds()], defaultRole: "user" }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const state = globalThis as typeof globalThis & { __aicAuth?: Auth };

export function getAuth(): Auth {
  return state.__aicAuth ??= createAuth();
}

export async function websiteSession(request: Request | Headers) {
  return getAuth().api.getSession({ headers: request instanceof Headers ? request : request.headers });
}
