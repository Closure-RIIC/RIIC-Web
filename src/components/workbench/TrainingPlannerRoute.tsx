"use client";

import { TrainingPlanner } from "@/components/pages/TrainingPlanner";
import { useWorkbench } from "@/workbench-context";

export function TrainingPlannerRoute() {
  const { trainingPlanner } = useWorkbench();
  return <TrainingPlanner key={trainingPlanner.identityKey} />;
}
