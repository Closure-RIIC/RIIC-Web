"use client";

import { WebsiteAccountPanel } from "@/components/auth/WebsiteAccountPanel";
import { StatusCenterPage } from "@/components/pages/StatusCenterShell";
import { useWorkbench } from "@/workbench-context";

export function AccountRoute() {
  const { account } = useWorkbench();
  return (
    <StatusCenterPage data-account-management>
      <WebsiteAccountPanel {...account} />
    </StatusCenterPage>
  );
}
