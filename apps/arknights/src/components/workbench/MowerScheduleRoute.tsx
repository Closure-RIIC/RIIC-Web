"use client";

import { MowerSchedulePage } from "@/components/pages/MowerSchedulePage";
import { useWorkbench } from "@/workbench-context";

export function MowerScheduleRoute() {
  const { manual } = useWorkbench();
  return <MowerSchedulePage operbox={manual.operbox} />;
}
