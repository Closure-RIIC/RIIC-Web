
import { AgentRoute } from "@/components/workbench/AgentRoute";
import { FeatureAccessBoundary } from "@/components/workbench/FeatureAccessProvider";



export default function Page() {
  return <FeatureAccessBoundary feature="agent"><AgentRoute /></FeatureAccessBoundary>;
}
