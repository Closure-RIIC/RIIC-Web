"use client";

import { useEffect } from "react";
import { useSklandTrainingSync, type SklandTrainingSyncOptions } from "@/hooks/use-skland-training-sync";

export type TrainingSyncSnapshot = {
  identity: string;
  resultId: string | null;
  value: ReturnType<typeof useSklandTrainingSync>;
};

// Loaded on the first training visit, then kept mounted to retain cooldowns and pending tasks.
export default function SklandTrainingSyncBridge({ options, onChange }: {
  options: SklandTrainingSyncOptions;
  onChange: (snapshot: TrainingSyncSnapshot) => void;
}) {
  const value = useSklandTrainingSync(options);
  useEffect(() => {
    onChange({ identity: options.identity, resultId: options.resultId, value });
  }, [onChange, options.identity, options.resultId, value]);
  return null;
}
