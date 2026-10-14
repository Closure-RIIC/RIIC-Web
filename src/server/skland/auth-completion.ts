import "@tanstack/react-start/server-only";

import type { SklandSessionData } from "../../types";
import { PublicApiError } from "../api-contract";
import type { CompletedSklandAuthentication } from "./adapter";
import { bindSklandAccount } from "./bindings";
import {
  readSklandAccountStore,
  sklandAccountSummaries,
  type SklandAccountStore,
} from "./http";
import { SklandAccountLimitError, upsertSklandAccount } from "./session";

export interface FinalizedSklandAuthentication {
  previous: SklandAccountStore;
  next: SklandAccountStore;
  data: SklandSessionData;
}

export async function finalizeSklandAuthentication(
  websiteUserId: string,
  result: CompletedSklandAuthentication,
  signal?: AbortSignal,
): Promise<FinalizedSklandAuthentication> {
  signal?.throwIfAborted();
  const previous = await readSklandAccountStore(websiteUserId);
  signal?.throwIfAborted();
  let upserted;
  try {
    upserted = upsertSklandAccount(previous.accounts, result.session, result.snapshot.roles);
  } catch (error) {
    if (error instanceof SklandAccountLimitError) throw new PublicApiError("AIC-AUTH-2004");
    throw error;
  }

  signal?.throwIfAborted();
  const bindingSummary = await bindSklandAccount(websiteUserId, result.session.userId);
  signal?.throwIfAborted();
  const next: SklandAccountStore = {
    ...previous,
    accounts: upserted.accounts,
    activeAccountId: upserted.account.accountId,
    migratedSnapshot: null,
  };
  return {
    previous,
    next,
    data: {
      authenticated: true,
      configured: true,
      authMethods: { qr: true, credential: true },
      accounts: sklandAccountSummaries(next),
      activeAccountId: next.activeAccountId,
      bindingCount: bindingSummary.totalCount,
      bindingSummary,
      scheduleSnapshot: result.snapshot,
      statusSnapshot: result.statusSnapshot,
    },
  };
}
