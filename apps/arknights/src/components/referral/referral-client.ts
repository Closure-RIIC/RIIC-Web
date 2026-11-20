import { useEffect, useState } from "react";
import type { ReferralRules } from "@riic/contracts/referral";

export type ReferralData = ReferralRules & {
  enabled: boolean;
  maxPoints: number;
  account: null | {
    code: string;
    registeredCount: number;
    qualifiedCount: number;
    rewardedCount: number;
    earnedPoints: number;
    welcomePoints: number;
    remainingRewards: number;
    referrals: Array<{
      id: string;
      createdAt: string;
      qualifiedAt: string | null;
      rewardedAt: string | null;
      status: "pending" | "qualified" | "rewarded" | "rejected" | "capped";
      points: number;
    }>;
  };
};

export async function readReferral(signal?: AbortSignal): Promise<ReferralData> {
  const response = await fetch("/api/referral", { credentials: "same-origin", cache: "no-store", signal });
  const payload = await response.json() as { data?: ReferralData };
  if (!response.ok || !payload.data) throw new Error("referral_unavailable");
  return payload.data;
}

export function useReferralEnabled(userId: string | null, pending: boolean): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (pending) return;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void readReferral(request.signal).then(data => setEnabled(data.enabled)).catch(() => {
        if (!request.signal.aborted) setEnabled(false);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { controller?.abort(); window.removeEventListener("focus", refresh); };
  }, [userId, pending]);
  return !pending && enabled;
}
