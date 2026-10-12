import { adminPageClass, AdminPageHeader } from "../admin-page";
import { BillingConsole } from "./billing-console";

export const dynamic = "force-dynamic";

export default function AdminBillingPage() {
  return <main id="admin-content" className={adminPageClass}>
    <AdminPageHeader title="billing" description="billingHint" />
    <BillingConsole />
  </main>;
}
