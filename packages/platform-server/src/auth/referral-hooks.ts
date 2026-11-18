import type { BetterAuthOptions } from "better-auth";

import { websiteAccountNameDatabaseHooks } from "./account-name-hooks";

type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type CreateUserHook = NonNullable<NonNullable<NonNullable<DatabaseHooks["user"]>["create"]>["before"]>;
type ReferralHookDependencies = {
  prepare: (code: string) => Promise<string | null>;
  capture: (userId: string, code: string) => Promise<unknown>;
  captureFailed: () => void;
};

const defaultDependencies: ReferralHookDependencies = {
  prepare: async (code) => (await import("../referral/service")).prepareReferralSignup(code),
  capture: async (userId, code) => (await import("../referral/service")).captureReferralForNewUser(userId, code),
  captureFailed: () => console.error(JSON.stringify({ level: "error", event: "referral_capture_deferred" })),
};

export const websiteReferralUserFields = {
  signupReferralCode: { type: "string", required: false, input: false, returned: false },
} as const;

export function createWebsiteReferralDatabaseHooks(dependencies = defaultDependencies) {
  return {
    ...websiteAccountNameDatabaseHooks,
    user: {
      ...websiteAccountNameDatabaseHooks.user,
      create: {
        async before(user: Parameters<CreateUserHook>[0], context: Parameters<CreateUserHook>[1]) {
          const named = await websiteAccountNameDatabaseHooks.user.create.before(user);
          const code = (context?.headers ?? context?.request?.headers)?.get("x-riic-referral-code")?.trim();
          const signupReferralCode = context?.path === "/sign-up/email" && code
            ? await dependencies.prepare(code)
            : null;
          // This private marker is inserted with the new user. An after hook runs
          // after the auth transaction and must not be the only attribution copy.
          return { data: { ...named.data, signupReferralCode } };
        },
        async after(user: Parameters<CreateUserHook>[0]) {
          if (typeof user.signupReferralCode !== "string" || !user.signupReferralCode) return;
          try {
            await dependencies.capture(user.id, user.signupReferralCode);
          } catch {
            // Binding and referral reads can recover from the durable marker.
            // Keep successful account creation usable during a transient failure.
            dependencies.captureFailed();
          }
        },
      },
    },
  } satisfies DatabaseHooks;
}

export const websiteReferralDatabaseHooks = createWebsiteReferralDatabaseHooks();
