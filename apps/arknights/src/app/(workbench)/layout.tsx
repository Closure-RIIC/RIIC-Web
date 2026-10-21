import WorkbenchApp from "@/App";
import { WebsiteSessionProvider, type WebsiteSessionData } from "@/website-session";
import { AgentRuntimeAccountBoundary } from "@/components/agent/AgentRuntimeProvider";
import { FeatureAccessProvider } from "@/components/workbench/FeatureAccessProvider";

export default function WorkbenchLayout({ children, initialSession }: Readonly<{
  children: React.ReactNode;
  initialSession?: WebsiteSessionData | null;
}>) {
  return (
    <WebsiteSessionProvider initialSession={initialSession}>
      <FeatureAccessProvider>
        <AgentRuntimeAccountBoundary />
        <WorkbenchApp>{children}</WorkbenchApp>
      </FeatureAccessProvider>
    </WebsiteSessionProvider>
  );
}
