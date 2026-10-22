"use client";
import { RecruitmentCalculator } from "@/components/pages/RecruitmentCalculator";
import { useWorkbench } from "@/workbench-context";

export function RecruitmentRoute() {
  const { recruitment } = useWorkbench();
  return <RecruitmentCalculator {...recruitment} />;
}
