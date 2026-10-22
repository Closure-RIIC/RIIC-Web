"use client";

import { DevelopmentSklandStatusCenter } from "@/components/pages/DevelopmentSklandStatusCenter";
import { useWorkbench } from "@/workbench-context";

export function SklandRoute() {
  const { skland } = useWorkbench();
  return skland ? <DevelopmentSklandStatusCenter {...skland} /> : null;
}
