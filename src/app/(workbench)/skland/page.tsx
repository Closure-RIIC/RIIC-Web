import { notFound } from "@/navigation";
import { SklandRoute } from "workbench-skland-route";


export default function Page() {
  if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") notFound();
  return <SklandRoute />;
}
