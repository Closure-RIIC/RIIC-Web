"use client";

import { createContext, useContext } from "react";

import type { WebsiteAccountPanelProps } from "@/components/auth/WebsiteAccountPanel";
import type { DevelopmentSklandStatusCenterProps } from "@/components/pages/DevelopmentSklandStatusCenter";
import type { InfraCalculatorProps } from "@/components/pages/InfraCalculator";
import type { ManualSchedulePageProps } from "@/components/pages/ManualSchedulePage";
import type { TrainingAdviceProps } from "@/components/pages/TrainingAdvice";
import type { MasteryPlannerProps } from "@/components/pages/MasteryPlanner";
import type { RecruitmentCalculatorProps } from "@/components/pages/RecruitmentCalculator";
import type { UserSettings } from "@/user-settings";
import type { AccountHealthRawInput } from "@/account-health-input";

export interface WorkbenchContextValue {
  inventory: { identityKey: string; pending: boolean };
  healthOperators: AccountHealthRawInput["operators"];
  calculator: InfraCalculatorProps;
  manual: ManualSchedulePageProps;
  training: TrainingAdviceProps;
  mastery: MasteryPlannerProps;
  recruitment: RecruitmentCalculatorProps;
  account: Omit<WebsiteAccountPanelProps, "loadingMode"> & {
    authenticated: boolean;
    pending: boolean;
  };
  settings: {
    value: UserSettings;
    onChange: (settings: UserSettings) => void;
  };
  skland: DevelopmentSklandStatusCenterProps | null;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

export function useWorkbench(): WorkbenchContextValue {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("工作台页面必须渲染在 WorkbenchApp 内。");
  return value;
}
