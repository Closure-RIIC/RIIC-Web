import { useEffect, useMemo, useState } from "react";
import type { planFarming } from "@/training-farming";

type Plan = ReturnType<typeof import("@/training-farming-crafts").planFarmingWithCrafts>;
type Request = Parameters<typeof planFarming>;

export function useTrainingFarmingPlan(needs: Request[0], drops: Request[1] | undefined, now: number, includeScheduledChips = false) {
  const request = useMemo<Request | null>(() => drops && needs.some((need) => need.missing > 0)
    ? [needs, drops, now, includeScheduledChips] : null, [needs, drops, now, includeScheduledChips]);
  const [result, setResult] = useState<{ request: Request; plan: Plan | null } | null>(null);

  useEffect(() => {
    if (!request) return;
    let worker: Worker | undefined;
    const finish = (plan: Plan | null) => {
      worker?.terminate();
      setResult({ request, plan });
    };
    try {
      worker = new Worker(new URL("../training-farming.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ plan: Plan | null }>) => finish(event.data.plan);
      worker.onerror = () => finish(null);
      worker.onmessageerror = () => finish(null);
      worker.postMessage(request);
    } catch {
      const timer = window.setTimeout(() => finish(null), 0);
      return () => {
        window.clearTimeout(timer);
        worker?.terminate();
      };
    }
    return () => worker?.terminate();
  }, [request]);

  const current = result?.request === request ? result : null;
  return { plan: current?.plan ?? null, pending: Boolean(request && !current), failed: current?.plan === null };
}
