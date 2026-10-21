import { APIError, type BetterAuthOptions } from "better-auth";

import { validateWebsiteAccountName } from "../../account-name.ts";

function validatedAccountName(value: unknown): string {
  const validation = validateWebsiteAccountName(value);
  if (validation.error) throw new APIError("BAD_REQUEST", { message: validation.error });
  return validation.name;
}

export const websiteAccountNameDatabaseHooks = {
  user: {
    create: {
      before: async (user) => ({ data: { ...user, name: validatedAccountName(user.name) } }),
    },
    update: {
      before: async (user) => {
        if (user.name === undefined) return;
        return { data: { ...user, name: validatedAccountName(user.name) } };
      },
    },
  },
} satisfies NonNullable<BetterAuthOptions["databaseHooks"]>;
