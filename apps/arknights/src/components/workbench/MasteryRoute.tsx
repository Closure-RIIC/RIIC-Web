"use client";
import { MasteryPlanner } from "@/components/pages/MasteryPlanner";
import { useWorkbench } from "@/workbench-context";

export function MasteryRoute() {
  const { mastery } = useWorkbench();
  return <MasteryPlanner key={mastery.identityKey} {...mastery} />;
}
