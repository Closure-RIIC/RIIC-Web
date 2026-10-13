import { pageMetadata } from "@/i18n/metadata";
import { notFound } from "next/navigation";
import { SklandRoute } from "workbench-skland-route";

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") notFound();
  return <SklandRoute />;
}

export function generateMetadata() { return pageMetadata("skland"); }
