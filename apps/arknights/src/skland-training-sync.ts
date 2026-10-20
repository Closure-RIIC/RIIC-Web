import { normalizeOperboxEntries } from "./operbox-normalization.ts";
import { effectiveFiammettaSetting } from "./plan-presentation.ts";
import type { BaseBlueprint, OperBoxEntry, PublicPlanData, RotationProfile, SklandSessionData } from "./types.ts";

export const SKLAND_TRAINING_INTERVAL_MS = 5 * 60_000;
export const SKLAND_TRAINING_MANUAL_INTERVAL_MS = 30_000;

export type TrainingData = Pick<PublicPlanData, "profile" | "trainingAdvice">;
export type TrainingInput = {
  identity: string;
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  rotation: RotationProfile;
  fiammettaEnabled: boolean;
};

// Upstream ordering and timestamps must not cause another solver request.
export function trainingInputKey(input: TrainingInput): string {
  return JSON.stringify({
    identity: input.identity,
    layout: input.layout,
    rotation: input.rotation,
    fiammetta: effectiveFiammettaSetting(input.operbox, input.rotation, input.fiammettaEnabled),
    operbox: normalizeOperboxEntries(input.operbox).map(({ id, name, elite, level, own, potential, rarity }) =>
      [id, name, elite, level, own, potential, rarity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

export function trainingSyncDue(now: number, lastAttempt: number | null, retryAt: number, manual: boolean): boolean {
  return now >= retryAt && (lastAttempt === null || now - lastAttempt >= (
    manual ? SKLAND_TRAINING_MANUAL_INTERVAL_MS : SKLAND_TRAINING_INTERVAL_MS
  ));
}

export async function refreshSklandTraining(input: TrainingInput, effects: {
  accountId: string;
  uid: string;
  sync: () => Promise<SklandSessionData>;
  isCurrent: () => boolean;
  cached: { key: string; data: TrainingData } | null;
  compute: (operbox: OperBoxEntry[], sourceName: string) => Promise<TrainingData>;
}) {
  const session = await effects.sync();
  if (!effects.isCurrent()) return null;
  const account = session.accounts.find((item) => item.accountId === session.activeAccountId);
  if (!session.authenticated || !session.scheduleSnapshot
    || account?.accountId !== effects.accountId || account.selectedUid !== effects.uid) {
    throw new Error("SKLAND_TRAINING_ACCOUNT_CHANGED");
  }
  const operbox = normalizeOperboxEntries(session.scheduleSnapshot.operbox);
  const key = trainingInputKey({ ...input, operbox });
  let data = effects.cached?.key === key ? effects.cached.data : null;
  let error: unknown = null;
  if (!data) {
    try {
      data = await effects.compute(operbox, session.scheduleSnapshot.sourceName);
    } catch (cause) {
      error = cause;
    }
  }
  if (!effects.isCurrent()) return null;
  return { session, operbox, key, data, error };
}
