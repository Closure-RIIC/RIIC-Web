import { adminPageClass, AdminPageHeader } from "../admin-page";
import { BillingConsole } from "../billing/billing-console";
import { AgentResourcesConsole } from "./resources-console";
export default function AdminAgentPage() {
  return <main id="admin-content" className={adminPageClass}><AdminPageHeader title="agent" description="agentHint" /><AgentResourcesConsole /><BillingConsole agent /></main>;
}
