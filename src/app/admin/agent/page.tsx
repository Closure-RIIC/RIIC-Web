import { adminPageClass, AdminPageHeader } from "../admin-page";
import { BillingConsole } from "../billing/billing-console";
export const dynamic = "force-dynamic";
export default function AdminAgentPage() {
  return <main id="admin-content" className={adminPageClass}><AdminPageHeader title="agent" description="agentHint" /><BillingConsole agent /></main>;
}
