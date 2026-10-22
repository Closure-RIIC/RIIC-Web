import { BillingPrototype } from "@/components/billing/BillingPrototype";
import { FeatureAccessBoundary } from "@/components/workbench/FeatureAccessProvider";



export default function Page() {
  return <FeatureAccessBoundary feature="billing"><BillingPrototype /></FeatureAccessBoundary>;
}
