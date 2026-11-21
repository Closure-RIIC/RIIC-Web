import { adminPageClass, AdminPageHeader } from "../admin-page";
import { BillingConsole } from "../billing/billing-console";
import { AgentResourcesConsole } from "./resources-console";
import { AgentArchiveLink } from "@/components/agent/AgentArchive";
export default function AdminAgentPage() {
  return <main id="admin-content" className={adminPageClass}><AdminPageHeader title="agent" description="agentHint" /><AgentArchiveLink admin /><AgentResourcesConsole /><BillingConsole agent /></main>;
}
