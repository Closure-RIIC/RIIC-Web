import { notFound } from "next/navigation";
import { pageMetadata } from "@/i18n/metadata";
import { GachaHistoryRoute } from "@/components/workbench/GachaHistoryRoute";

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") notFound();
  return <GachaHistoryRoute />;
}

export function generateMetadata() { return pageMetadata("gacha"); }
