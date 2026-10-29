import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../../messages/zh-CN/AK_Raw_app_plan__id__page.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_app_plan__id__page");
import { PlanArtifactView } from "@/components/agent/PlanArtifactView";



import type { getPlanArtifactPage } from "@/server/page-data";

export default function PlanArtifactPage({ artifact }: { artifact: Awaited<ReturnType<typeof getPlanArtifactPage>> }) {
  const rawLocale = useRawLocale();
  const createdAt = new Intl.DateTimeFormat(rawLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(artifact.createdAt));
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6" data-plan-artifact-page>
      <header className="mb-4 flex items-center gap-2.5">
        <span className="h-7 w-1.5 shrink-0 bg-[#FFD501]" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="truncate text-[21px] font-medium leading-none">{rawText.text(rawLocale, "scheduleGeneratedByClosure")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{rawText.rich(rawLocale, "generatedLayoutOperatorsKeptFor7Days", { part1: richValue((createdAt)), part2: richValue((artifact.meta.layoutPreset)), part3: richValue((artifact.meta.operatorCount)), part4: richValue((artifact.meta.factoryRecipes?.length ? rawText.text(rawLocale, "factoryRecipes", { recipes: artifact.meta.factoryRecipes.join(" / ") }) : "")), part5: richValue((artifact.meta.tradeOrders?.length ? rawText.text(rawLocale, "tradeOrders", { orders: artifact.meta.tradeOrders.join(" / ") }) : "")) })}</p>
        </div>
      </header>
      <PlanArtifactView plan={JSON.parse(artifact.planJson)} />
      <p className="mt-6 text-xs text-muted-foreground">
        <a className="underline underline-offset-4" href="/agent">{rawText.text(rawLocale, "backToClosureAssistant")}</a>
      </p>
    </section>
  );
}
