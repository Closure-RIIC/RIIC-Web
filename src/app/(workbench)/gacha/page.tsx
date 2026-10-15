import { notFound } from "@/navigation";
import { GachaHistoryRoute } from "@/components/workbench/GachaHistoryRoute";


export default function Page() {
  if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") notFound();
  return <GachaHistoryRoute />;
}
