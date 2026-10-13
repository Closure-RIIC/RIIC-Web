import { notFound, redirect } from "next/navigation";
import { pageMetadata } from "@/i18n/metadata";
import { isSklandTab } from "@/workbench-routes";
import { SklandRoute } from "workbench-skland-route";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") notFound();
  if (tab === "gacha") redirect("/gacha");
  if (!isSklandTab(tab)) notFound();
  if (tab === "overview") redirect("/skland");
  return <SklandRoute />;
}

export function generateMetadata() { return pageMetadata("skland"); }
