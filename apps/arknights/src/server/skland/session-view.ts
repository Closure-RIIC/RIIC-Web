import type {
  SklandAccountSummary,
  SklandBindingSummary,
  SklandScheduleSnapshot,
  SklandSessionData,
  SklandStatusSnapshot,
} from "../../types.ts";
import { PublicApiError } from "../api-contract.ts";

export type SklandSessionMode = "full" | "summary";

export function sklandSessionMode(url: string): SklandSessionMode {
  const values = new URL(url).searchParams.getAll("mode");
  if (values.length === 0) return "full";
  if (values.length === 1 && values[0] === "summary") return "summary";
  throw new PublicApiError("AIC-REQ-1001");
}

export async function resolveSklandSessionView<TStore>({
  mode,
  store,
  bindingSummary,
  accountSummaries,
  activeAccountId,
  loadFull,
}: {
  mode: SklandSessionMode;
  store: TStore;
  bindingSummary: SklandBindingSummary;
  accountSummaries: (store: TStore) => SklandAccountSummary[];
  activeAccountId: (store: TStore) => string | null;
  loadFull: (store: TStore) => Promise<{
    store: TStore;
    snapshot: SklandScheduleSnapshot | null;
    statusSnapshot: SklandStatusSnapshot | null;
  }>;
}): Promise<{ data: SklandSessionData; store: TStore; refreshed: boolean }> {
  if (mode === "summary") {
    const accounts = accountSummaries(store);
    const selectedAccountId = activeAccountId(store);
    return {
      data: {
        authenticated: Boolean(selectedAccountId && accounts.some((account) => account.accountId === selectedAccountId)),
        configured: true,
        authMethods: { qr: true, credential: true },
        accounts,
        activeAccountId: selectedAccountId,
        bindingCount: bindingSummary.totalCount,
        bindingSummary,
      },
      store,
      refreshed: false,
    };
  }

  const loaded = await loadFull(store);
  return {
    data: {
      authenticated: Boolean(loaded.snapshot),
      configured: true,
      authMethods: { qr: true, credential: true },
      accounts: accountSummaries(loaded.store),
      activeAccountId: activeAccountId(loaded.store),
      bindingCount: bindingSummary.totalCount,
      bindingSummary,
      ...(loaded.snapshot ? { scheduleSnapshot: loaded.snapshot } : {}),
      ...(loaded.statusSnapshot ? { statusSnapshot: loaded.statusSnapshot } : {}),
    },
    store: loaded.store,
    refreshed: true,
  };
}
