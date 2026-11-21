import { useTrainingFarmingPlan } from "@/hooks/use-training-farming-plan";
import { PackageOpen } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { withMessages } from "@/i18n/features-client";
import { useGameCatalog } from "@/i18n/game-data-client";
import { pageHead } from "@/i18n/metadata";
import { CHIP_CATALYST, CHIP_STAGE_BY_ITEM, CHIP_STAGE_DAYS, cnGameWeekday, planCatalystExchange, PURCHASE_CERTIFICATE, type FarmingSnapshot } from "@/training-farming";
import plannerData from "@/generated/training-planner-data.json" with { type: "json" };

const catalog = new Map(Object.entries(plannerData.items));
const maxQuantity = 1_000_000;

function MaterialIcon({ id }: { id: string }) {
  const src = catalog.get(id)?.icon;
  return src ? (
    <img src={src} alt="" width={28} height={28} className="size-7 shrink-0 object-contain" loading="lazy" />
  ) : (
    <PackageOpen className="size-7 shrink-0 p-1 text-muted-foreground" aria-hidden="true" />
  );
}

function parseMaterials(value: string) {
  const counts: Record<string, number> = {};
  for (const token of value.split(",").slice(0, catalog.size)) {
    const [id, raw] = token.split(":");
    const quantity = Number(raw);
    if (catalog.has(id) && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= maxQuantity) counts[id] = quantity;
  }
  return counts;
}

function FarmingPage() {
  const { materials, certificates = 0 } = Route.useSearch();
  return <FarmingWorkspace key={JSON.stringify([materials, certificates])} materials={materials} certificates={certificates} />;
}

function FarmingWorkspace({ materials, certificates }: { materials: string; certificates: number }) {
  const t = useTranslations("TrainingPlanner");
  const locale = useLocale();
  const { itemNames } = useGameCatalog();
  const [counts, setCounts] = useState(() => parseMaterials(materials));
  const [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<FarmingSnapshot>();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [ownedCertificates, setOwnedCertificates] = useState(certificates);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);

  async function loadDrops() {
    setStatus("loading");
    try {
      const response = await fetch("/api/training/farming", { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("Drop data unavailable");
      setSnapshot(await response.json() as FarmingSnapshot);
      setNow(Date.now());
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  const name = (id: string) => itemNames[id] ?? catalog.get(id)?.name ?? id;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const needs = useMemo(() => Object.entries(counts).map(([id, missing]) => ({ id, missing })), [counts]);
  const { expandedNeeds, manufacturing } = useMemo(() => {
    const expanded = new Map(needs.map(({ id, missing }) => [id, missing]));
    const manufacturing = needs.flatMap(({ id, missing }) => {
      if (missing <= 0) return [];
      const recipe = catalog.get(id)?.recipes.find(({ facility, output, inputs }) =>
        facility === "MANUFACTURE" && output > 0 &&
        inputs.some((input) => input.id === CHIP_CATALYST) &&
        inputs.some((input) => CHIP_STAGE_BY_ITEM[input.id]));
      if (!recipe) return [];
      const batches = Math.ceil(missing / recipe.output);
      expanded.delete(id);
      for (const input of recipe.inputs) expanded.set(input.id, (expanded.get(input.id) ?? 0) + input.count * batches);
      return [{ id, missing, recipe, batches }];
    });
    return { expandedNeeds: [...expanded].map(([id, missing]) => ({ id, missing })), manufacturing };
  }, [needs]);
  const catalysts = expandedNeeds.find(({ id }) => id === CHIP_CATALYST)?.missing ?? 0;
  const exchange = catalysts > 0 && now > 0 ? planCatalystExchange(catalysts, now, ownedCertificates) : null;
  const stageNeeds = useMemo(() => expandedNeeds.filter(({ id }) => id !== CHIP_CATALYST), [expandedNeeds]);
  const { plan, pending: solving, failed: solveFailed } = useTrainingFarmingPlan(stageNeeds, snapshot?.drops, now, true);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <WorkbenchPageHeading page="training-planner">{t("farmingPage")} <span className="ml-2 border border-border bg-muted px-1.5 py-0.5 align-middle text-xs font-medium">Demo</span></WorkbenchPageHeading>
      <p className="text-sm text-muted-foreground">{t("farmingDescription")}</p>
      <Link to="/training-plan" className="inline-block text-sm underline">{t("farmingBack")}</Link>
      <section className="space-y-3 border border-border bg-card p-4">
        <h2 className="font-semibold">{t("farmingMaterials")}</h2>
        {needs.length === 0 && (
          <Button type="button" variant="outline" onClick={() => setCounts({ "30012": 20, "30022": 6 })}>
            {t("farmingExample")}
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <select className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm" aria-label={t("farmingMaterials")} value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">{t("farmingSelect")}</option>
            {[...catalog.keys()].filter((id) => !(id in counts)).map((id) => <option key={id} value={id}>{name(id)}</option>)}
          </select>
          <Button type="button" variant="outline" disabled={!selected} onClick={() => {
            setCounts((current) => ({ ...current, [selected]: 1 }));
            setSelected("");
          }}>{t("farmingAdd")}</Button>
        </div>
        {needs.map(({ id, missing }) => (
          <div key={id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <span className="flex min-w-0 items-center gap-2 text-sm"><MaterialIcon id={id} />{name(id)}</span>
            <div className="flex items-center gap-2">
              <Input className="w-28" aria-label={name(id)} type="number" min={1} max={maxQuantity} step={1} value={missing || ""} onChange={(event) => {
                const value = event.target.valueAsNumber;
                setCounts((current) => ({ ...current, [id]: Number.isSafeInteger(value) ? Math.min(maxQuantity, Math.max(0, value)) : 0 }));
              }} />
              <Button type="button" variant="ghost" onClick={() => setCounts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))}>{t("farmingRemove")}</Button>
            </div>
          </div>
        ))}
        <Button type="button" disabled={status === "loading" || !stageNeeds.some((need) => need.missing > 0)} onClick={() => void loadDrops()}>
          {status === "loading" ? t("farmingLoading") : t("farmingLoad")}
        </Button>
        {status === "error" && <p role="status" className="text-sm">{t("farmingError")}</p>}
      </section>
      {manufacturing.map(({ id, missing, recipe, batches }) => (
        <div key={id} className="space-y-1 border border-border bg-card p-3 text-sm">
          <h2 className="flex items-center gap-2 font-semibold">
            <MaterialIcon id={id} />{name(id)} ×{number.format(missing)}
          </h2>
          <p>{t("craftEntry", { count: batches, facility: t("manufacture"), level: recipe.level })}</p>
          <ul className="flex flex-wrap gap-3">
            {recipe.inputs.map((input) => (
              <li key={input.id} className="flex items-center gap-1"><MaterialIcon id={input.id} />{name(input.id)} ×{number.format(input.count * batches)}</li>
            ))}
          </ul>
          {now > 0 && recipe.inputs.some(({ id: inputId }) => {
            const stage = CHIP_STAGE_BY_ITEM[inputId];
            return stage && !CHIP_STAGE_DAYS[stage]?.includes(cnGameWeekday(now));
          }) && <p className="text-muted-foreground">{t("farmingChipStageClosed")}</p>}
        </div>
      ))}
          {exchange && (
            <div className="space-y-1 border border-border p-3 text-sm">
              <h3 className="flex items-center gap-2 font-semibold">
                <MaterialIcon id={CHIP_CATALYST} />
                {t("farmingCatalystExchange", { count: number.format(catalysts), tickets: number.format(exchange.certificates) })}
              </h3>
              <label className="flex flex-wrap items-center gap-2">
                {t("farmingOwnedCertificates")}
                <Input className="w-28" type="number" min={0} max={maxQuantity} step={1} value={ownedCertificates} onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  setOwnedCertificates(Number.isSafeInteger(value) ? Math.min(maxQuantity, Math.max(0, value)) : 0);
                }} />
              </label>
              <p className="flex items-center gap-2">
                <MaterialIcon id={PURCHASE_CERTIFICATE} />
                {exchange.certificates === 0 ? t("farmingCertificatesCovered") : t("farmingCertificateRuns", { runs: number.format(exchange.runs), sanity: number.format(exchange.sanity),
                  min: number.format(exchange.minRuns), max: number.format(exchange.conservativeRuns) })}
              </p>
              {exchange.certificates > 0 && <p className="text-muted-foreground">{exchange.open ? t("farmingApOpen") : t("farmingApClosed")}</p>}
              <a className="text-xs underline" href="https://prts.wiki/w/Wk_toxic_5" target="_blank" rel="noreferrer">AP-5 · PRTS</a>
            </div>
          )}
      {solving && <p role="status" className="text-sm text-muted-foreground">{t("farmingSolving")}</p>}
      {solveFailed && <p role="status" className="text-sm text-muted-foreground">{t("farmingSolveFailed")}</p>}
      {snapshot && plan && stageNeeds.some((need) => need.missing > 0) && (
        <section className="space-y-4 border border-border bg-card p-4">
          <h2 className="font-semibold">{t("farmingCombined")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("farmingNote", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(snapshot.fetchedAt) })}{" "}
            <a className="underline" href="https://penguin-stats.io/" target="_blank" rel="noreferrer">Penguin Statistics</a>{" · "}
            <a className="underline" href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">CC BY-NC 4.0</a>
          </p>
          {exchange && plan.uncovered.length === 0 && (
            <p className="font-semibold">{t("farmingIncludingTickets", {
              total: number.format(plan.totalSanity + exchange.sanity),
              stages: number.format(plan.totalSanity), tickets: number.format(exchange.sanity),
            })}</p>
          )}
          {plan.stages.length > 0 && <>
            <p className="text-sm font-medium">{t("farmingTotal", { sanity: number.format(plan.totalSanity) })} · {t("farmingSeparate", { sanity: number.format(plan.separateSanity) })}</p>
            {plan.separateSanity > plan.totalSanity && (
              <p className="text-sm font-medium text-emerald-700">{t("farmingSaved", { sanity: number.format(plan.separateSanity - plan.totalSanity) })}</p>
            )}
            <ul className="space-y-2 text-sm">
              {plan.stages.map((stage) => (
                <li key={stage.stageId} className="border-t border-border pt-2">
                  <strong>{t("farmingStage", { stage: stage.code, runs: number.format(stage.runs), sanity: number.format(stage.totalSanity) })}</strong>
                  {CHIP_STAGE_DAYS[stage.stageId] && !CHIP_STAGE_DAYS[stage.stageId]?.includes(cnGameWeekday(now)) && (
                    <span className="ml-2 text-amber-700">{t("farmingChipWait", { stage: stage.code })}</span>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                    {Object.entries(stage.expectedDrops).map(([id, count]) => (
                      <span key={id} className="inline-flex items-center gap-1">
                        <MaterialIcon id={id} />{name(id)} ×{number.format(count)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>}
          {plan.crafts.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
              <h3 className="font-medium">{t("craftingPlan")}</h3>
              <ul className="space-y-1">
                {plan.crafts.map((craft, index) => (
                  <li key={`${craft.id}:${index}`}>
                    {name(craft.id)} ×{number.format(craft.count)} · {t("craftEntry", { count: number.format(craft.batches), facility: t("workshop"), level: craft.level })}
                    {" · "}{t("craftCost", { count: number.format(craft.lmd) })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.uncovered.length > 0 && <p className="text-sm text-muted-foreground">{t("farmingUncovered", { items: plan.uncovered.map(name).join(" · ") })}</p>}
        </section>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_workbench/farming-plan")({
  validateSearch: (search: Record<string, unknown>) => ({
    certificates: typeof search.certificates === "number" && Number.isSafeInteger(search.certificates) && search.certificates > 0
      ? Math.min(maxQuantity, search.certificates) : undefined,
    materials: typeof search.materials === "string" ? search.materials.slice(0, 4096) : "",
  }),
  head: ({ matches }) => pageHead(matches, "trainingPlanner"),
  component: withMessages(withPageScrollbars(FarmingPage), "apps/arknights/src/routes/_workbench.farming-plan.tsx"),
});
