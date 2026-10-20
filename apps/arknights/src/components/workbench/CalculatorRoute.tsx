"use client";

import { InfraCalculator } from "@/components/pages/InfraCalculator";
import { useWorkbench } from "@/workbench-context";

export function CalculatorRoute() {
  const { calculator } = useWorkbench();
  return <InfraCalculator {...calculator} />;
}
