"use client";

import { TrainingAdvice } from "@/components/pages/TrainingAdvice";
import { useWorkbench } from "@/workbench-context";

export function TrainingRoute() {
  const { training } = useWorkbench();
  return <TrainingAdvice {...training} />;
}
