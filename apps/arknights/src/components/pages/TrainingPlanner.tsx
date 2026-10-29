"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "use-intl";
import { Check, ChevronDown, PackageOpen, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

import { getSklandInventory } from "@/api";
import { OperatorIdentity, OperatorProfessionFilter, OperatorRarityFilter, OperatorRosterGrid, OperatorSearch, OPERATOR_PAGE_SIZE } from "@/components/operators/OperatorPickerParts";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { manualLevelFor, maxEliteForRarity } from "@riic/arknights-domain/manual-operbox";
import { OPERATOR_CATALOG, type OperatorAssetRecord } from "@/operatorPortraits";
import type { OperBoxEntry, SklandInventoryData, SklandOperatorStatus } from "@riic/arknights-domain/types";
import { useWorkbench } from "@/workbench-context";
import { calculateTrainingPlan, defaultTrainingGoal, isTrainingFullyComplete, mergeTrainingGoalCurrent, type TrainingGoal, type TrainingPlannerData } from "@/training-planner";
import { buildTrainingPlannerContext } from "@/agent-page-context";
import { loadTrainingGoals, loadTrainingInventory, saveTrainingGoals, saveTrainingInventory, takeTrainingPlannerHandoff } from "@/training-planner-store";
import plannerDataJson from "@/generated/training-planner-data.json" with { type: "json" };
import { cn } from "@/lib/utils";
import { workbenchPageAccent } from "@/workbench-accent";

const plannerData = plannerDataJson as TrainingPlannerData;
const OPERATOR_BY_ID = new Map(OPERATOR_CATALOG.map((operator) => [operator.id, operator]));
const BOOK_IDS = ["2001", "2002", "2003", "2004"];
const MONEY_IDS = ["4001", "3003"];
const MATERIAL_IDS = (() => {
  const ids = new Set(Object.values(plannerData.operators).flatMap((operator) => [
  ...operator.phases.flatMap((phase) => phase.map((item) => item.id)),
  ...operator.skillLevels.flatMap((level) => level.map((item) => item.id)),
  ...operator.skills.flatMap((skill) => skill.masteries.flatMap((level) => level.map((item) => item.id))),
  ...operator.modules.flatMap((module) => Object.values(module.costs).flatMap((level) => level.map((item) => item.id))),
  ]));
  const pending = [...ids];
  while (pending.length) {
    const id = pending.pop()!;
    for (const recipe of plannerData.items[id]?.recipes ?? []) {
      for (const ingredient of recipe.inputs) {
        if (!ids.has(ingredient.id)) {
          ids.add(ingredient.id);
          pending.push(ingredient.id);
        }
      }
    }
  }
  return [...ids]
    .filter((id) => ![...BOOK_IDS, ...MONEY_IDS].includes(id) && plannerData.items[id])
    .sort((left, right) => (plannerData.items[right]?.rarity ?? 0) - (plannerData.items[left]?.rarity ?? 0)
      || (plannerData.items[left]?.name ?? left).localeCompare(plannerData.items[right]?.name ?? right, "zh-CN"));
})();
const numberText = (value: number) => value.toLocaleString("zh-CN");
const EMPTY_GOALS: TrainingGoal[] = [];
const EMPTY_INVENTORY: Record<string, number> = {};
type StoredPlan = { identity: string; loaded: boolean; goals: TrainingGoal[] };
type StoredInventory = { identity: string; loaded: boolean; values: Record<string, number> };

function mergeHandoff(
  goals: TrainingGoal[],
  handoff: ReturnType<typeof takeTrainingPlannerHandoff>,
  operbox: OperBoxEntry[] | null,
  operators: SklandOperatorStatus[],
) {
  const next = goals.map((goal) => {
    const operator = OPERATOR_BY_ID.get(goal.operatorId);
    const currentStatus = operators.find((entry) => entry.id === goal.operatorId);
    if (!operator || !currentStatus) return goal;
    const current = defaultTrainingGoal(
      operator,
      { elite: currentStatus.elite, level: currentStatus.level, own: true },
      currentStatus,
      plannerData.operators[goal.operatorId]?.skills,
      plannerData.operators[goal.operatorId]?.modules,
    );
    return mergeTrainingGoalCurrent(goal, current);
  });
  const statusById = new Map(operators.map((operator) => [operator.id, operator]));
  for (const target of handoff) {
    const operator = OPERATOR_BY_ID.get(target.operatorId);
    if (!operator) continue;
    const currentStatus = statusById.get(target.operatorId);
    const currentBox = operbox?.find((entry) => entry.id === target.operatorId);
    const existing = next.findIndex((goal) => goal.operatorId === target.operatorId);
    const base = existing >= 0 ? next[existing]! : defaultTrainingGoal(
      operator,
      currentBox,
      currentStatus,
      plannerData.operators[target.operatorId]?.skills,
      plannerData.operators[target.operatorId]?.modules,
    );
    const merged = {
      ...base,
      targetElite: target.targetElite,
      targetLevel: target.targetLevel,
    };
    if (existing >= 0) next[existing] = merged;
    else next.push(merged);
  }
  return next;
}

function selectElement(label: string, value: number, onChange: (value: number) => void, options: number[], disabled = false) {
  return <div className="grid min-w-0 gap-1 text-[11px] text-muted-foreground">
    <span>{label}</span>
    <Combobox<number>
      items={options}
      filteredItems={options}
      value={value}
      inputValue={String(value)}
      itemToStringValue={String}
      disabled={disabled}
      onValueChange={(next) => { if (next !== null) onChange(next); }}
    >
      <ComboboxInput aria-label={label} readOnly disabled={disabled} className="h-9 w-full min-w-0 bg-background text-foreground max-sm:min-h-11" />
      <ComboboxContent align="start">
        <ComboboxList>
          {(option: number) => <ComboboxItem key={option} value={option}>{option}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>;
}

function inventoryLabel(itemId: string, translate: ReturnType<typeof useTranslations<"TrainingPlanner">>, itemNames: Record<string, string>) {
  if (itemId === "4001") return translate("lmd");
  if (itemId === "3003") return translate("redGold");
  return itemNames[itemId] ?? plannerData.items[itemId]?.name ?? itemId;
}

export function TrainingPlanner() {
  const t = useTranslations("TrainingPlanner");
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const { trainingPlanner, inventory, agent } = useWorkbench();
  const onPageContextChange = agent.onPageContextChange;
  const { operbox, operators, identityKey } = trainingPlanner;
  const [planState, setPlanState] = useState<StoredPlan>({ identity: "", loaded: false, goals: [] });
  const loadedIdentityRef = useRef<string | null>(null);
  const [inventoryState, setInventoryState] = useState<StoredInventory>({ identity: "", loaded: false, values: {} });
  const [inventoryOverrides, setInventoryOverrides] = useState<StoredInventory>({ identity: "", loaded: false, values: {} });
  const inventoryOverridesRef = useRef<StoredInventory>({ identity: "", loaded: false, values: {} });
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(false);
  const [inventorySaveFailed, setInventorySaveFailed] = useState(false);
  const [inventoryFetched, setInventoryFetched] = useState<SklandInventoryData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState("box");
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [profession, setProfession] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(OPERATOR_PAGE_SIZE);
  const [materialQuery, setMaterialQuery] = useState("");
  const [dailyLmd, setDailyLmd] = useState(0);
  const [dailyExperience, setDailyExperience] = useState(0);
  const [planSaveFailed, setPlanSaveFailed] = useState(false);

  const goals = planState.identity === identityKey ? planState.goals : EMPTY_GOALS;
  const stock = inventoryState.identity === identityKey ? inventoryState.values : EMPTY_INVENTORY;
  const currentById = useMemo(() => new Map(operbox?.map((entry) => [entry.id, entry]) ?? []), [operbox]);
  const statusById = useMemo(() => new Map(operators.map((entry) => [entry.id, entry])), [operators]);
  const roster = useMemo(() => {
    const box = (operbox ?? []).filter((entry) => entry.own).flatMap((entry) => {
      const catalog = OPERATOR_BY_ID.get(entry.id);
      return catalog ? [catalog] : [];
    });
    const seen = new Set<string>();
    return [...box, ...OPERATOR_CATALOG].filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }).sort((left, right) => right.rarity - left.rarity || right.order - left.order || left.name.localeCompare(right.name, "zh-CN"));
  }, [operbox]);
  const currentRoster = useMemo(() => (operbox ?? []).filter((entry) => entry.own).flatMap((entry) => {
    const operator = OPERATOR_BY_ID.get(entry.id);
    return operator ? [operator] : [];
  }).sort((left, right) => right.rarity - left.rarity || right.order - left.order), [operbox]);
  const filteredRoster = useMemo(() => {
    const source = pickerTab === "box" ? currentRoster : roster;
    const normalized = query.trim().toLocaleLowerCase(locale);
    return source.filter((operator) => (
      !isTrainingFullyComplete(operator.rarity, statusById.get(operator.id), plannerData.operators[operator.id])
      && (rarity === "all" || operator.rarity === Number(rarity))
      && (profession === "all" || operator.profession === Number(profession))
      && (!normalized
        || operator.id.toLocaleLowerCase("en-US").includes(normalized)
        || operator.name.toLocaleLowerCase("zh-CN").includes(normalized)
        || localizedOperatorName(operator.name, locale, gameCatalog).toLocaleLowerCase(locale).includes(normalized))
    ));
  }, [currentRoster, gameCatalog, locale, pickerTab, profession, query, rarity, roster, statusById]);

  useEffect(() => {
    if (loadedIdentityRef.current === identityKey) return;
    loadedIdentityRef.current = identityKey;
    const saved = loadTrainingGoals(identityKey);
    const handoff = takeTrainingPlannerHandoff();
    const merged = mergeHandoff(saved, handoff, operbox, operators);
    setPlanState({ identity: identityKey, loaded: true, goals: merged });
  }, [identityKey, operbox, operators]);

  useEffect(() => {
    if (planState.identity !== identityKey || !planState.loaded) return;
    setPlanState((current) => {
      if (current.identity !== identityKey || !current.loaded) return current;
      const goals = mergeHandoff(current.goals, [], operbox, operators);
      return JSON.stringify(goals) === JSON.stringify(current.goals) ? current : { ...current, goals };
    });
  }, [identityKey, operbox, operators, planState]);

  useEffect(() => {
    if (planState.identity !== identityKey || !planState.loaded) return;
    setPlanSaveFailed(!saveTrainingGoals(identityKey, planState.goals));
  }, [identityKey, planState]);

  const refreshInventory = useCallback(async () => {
    setInventoryLoading(true);
    setInventoryError(false);
    try {
      const result = await getSklandInventory();
      if (result.identityKey !== identityKey) throw new Error("Inventory account changed.");
      const upstream = Object.fromEntries(result.items.map((item) => [item.id, item.count]));
      const saved = inventoryOverridesRef.current.identity === identityKey
        ? inventoryOverridesRef.current.values
        : loadTrainingInventory(identityKey);
      setInventoryFetched(result);
      setInventoryState({ identity: identityKey, loaded: true, values: { ...upstream, ...saved } });
    } catch {
      setInventoryError(true);
      const saved = inventoryOverridesRef.current.identity === identityKey
        ? inventoryOverridesRef.current.values
        : loadTrainingInventory(identityKey);
      setInventoryState({ identity: identityKey, loaded: true, values: saved });
    } finally {
      setInventoryLoading(false);
    }
  }, [identityKey]);

  useEffect(() => {
    const overrides = { identity: identityKey, loaded: true, values: loadTrainingInventory(identityKey) };
    inventoryOverridesRef.current = overrides;
    setInventoryOverrides(overrides);
    setInventoryState(overrides);
    void refreshInventory();
  }, [identityKey, refreshInventory]);

  useEffect(() => {
    if (inventoryOverrides.identity !== identityKey || !inventoryOverrides.loaded) return;
    setInventorySaveFailed(!saveTrainingInventory(identityKey, inventoryOverrides.values));
  }, [identityKey, inventoryOverrides]);

  const result = useMemo(() => calculateTrainingPlan({
    goals,
    operators: OPERATOR_CATALOG.map(({ id, rarity }) => ({ id, rarity })),
    data: plannerData,
    inventory: stock,
  }), [goals, stock]);
  const goalOperators = useMemo(() => goals.flatMap((goal) => {
    const operator = OPERATOR_BY_ID.get(goal.operatorId);
    return operator ? [{
      id: operator.id,
      name: localizedOperatorName(operator.name, locale, gameCatalog),
      rarity: operator.rarity,
    }] : [];
  }), [gameCatalog, goals, locale]);

  useEffect(() => {
    if (planState.identity !== identityKey || !planState.loaded || inventoryState.identity !== identityKey || !inventoryState.loaded) {
      onPageContextChange("training-planner", null);
      return;
    }
    const inventoryStatus = inventoryLoading
      ? "正在刷新森空岛库存"
      : inventoryError
        ? "森空岛库存不可用，使用已保存或手动库存"
        : inventoryFetched
          ? "已同步森空岛库存并合并手动调整"
          : "使用已保存或手动库存";
    onPageContextChange("training-planner", buildTrainingPlannerContext({
      goals,
      operators: goalOperators,
      data: plannerData,
      result,
      inventory: stock,
      dailyLmd,
      dailyExperience,
      inventoryStatus: inventorySaveFailed ? `${inventoryStatus}；手动库存保存失败` : inventoryStatus,
    }));
  }, [dailyExperience, dailyLmd, goalOperators, goals, identityKey, inventoryError, inventoryFetched, inventoryLoading, inventorySaveFailed, inventoryState, onPageContextChange, planState, result, stock]);

  useEffect(() => () => onPageContextChange("training-planner", null), [onPageContextChange]);

  const visibleMaterials = MATERIAL_IDS.filter((id) => (
    !materialQuery.trim() || inventoryLabel(id, t, gameCatalog.itemNames).toLocaleLowerCase(locale)
      .includes(materialQuery.trim().toLocaleLowerCase(locale))
  ));
  const countFor = (id: string) => Math.max(0, Math.floor(stock[id] ?? 0));

  const updateGoals = (update: (current: TrainingGoal[]) => TrainingGoal[]) => setPlanState((current) => ({
    identity: identityKey,
    loaded: true,
    goals: update(current.identity === identityKey ? current.goals : []),
  }));

  const addOperator = (operator: OperatorAssetRecord) => updateGoals((current) => {
    if (current.some((goal) => goal.operatorId === operator.id)) return current;
    return [...current, defaultTrainingGoal(
      operator,
      currentById.get(operator.id),
      statusById.get(operator.id),
      plannerData.operators[operator.id]?.skills,
      plannerData.operators[operator.id]?.modules,
    )];
  });

  const updateGoal = (id: string, update: (goal: TrainingGoal) => TrainingGoal) => updateGoals((current) => current.map((goal) => (
    goal.operatorId === id ? update(goal) : goal
  )));

  const setInventoryCount = (id: string, raw: string) => {
    const count = raw.trim() === "" ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
    const currentOverrides = inventoryOverridesRef.current.identity === identityKey
      ? inventoryOverridesRef.current.values
      : {};
    const nextOverrides = { ...currentOverrides, [id]: count };
    const nextOverrideState = { identity: identityKey, loaded: true, values: nextOverrides };
    inventoryOverridesRef.current = nextOverrideState;
    setInventoryOverrides(nextOverrideState);
    setInventoryState((current) => ({
      identity: identityKey,
      loaded: true,
      values: { ...(current.identity === identityKey ? current.values : {}), [id]: count },
    }));
  };

  return (
    <main className="grid min-w-0 gap-5 pb-10 pt-5" data-training-planner>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <WorkbenchPageHeading page="training-planner">{t("title")}</WorkbenchPageHeading>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SetupActionButton type="button" variant="outline" className="!min-w-0 max-w-full max-md:px-3" onClick={() => { setPickerTab(currentRoster.length ? "box" : "all"); setPickerOpen(true); }}>
            <Plus />{t("addOperator")}
          </SetupActionButton>
          <SetupActionButton type="button" variant="outline" className="!min-w-0 max-w-full max-md:px-3" onClick={() => void refreshInventory()} disabled={inventoryLoading}>
            <RefreshCw className={cn(inventoryLoading && "animate-spin")} />{t("refreshInventory")}
          </SetupActionButton>
        </div>
      </header>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)]">
        <div className="grid min-w-0 content-start gap-6">
          <section className="min-w-0" aria-labelledby="training-targets-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="h-5 w-1 bg-[#B8F03A]" aria-hidden="true" />
                <h2 id="training-targets-heading" className="text-base font-semibold">{t("selected", { count: goals.length })}</h2>
              </div>
              {goals.length ? <Button type="button" variant="ghost" size="sm" onClick={() => updateGoals(() => [])}><Trash2 className="size-4" />{t("clearGoals")}</Button> : null}
            </div>
            {!goals.length ? <WorkbenchCard glass accent={workbenchPageAccent("training-planner")} className="grid min-h-40 place-content-center text-center text-sm text-muted-foreground" data-training-empty>
              <PackageOpen className="mx-auto mb-3 size-6 opacity-60" aria-hidden="true" />
              <p>{t("noTargets")}</p>
              <Button type="button" variant="outline" className="mx-auto mt-4" onClick={() => { setPickerTab(currentRoster.length ? "box" : "all"); setPickerOpen(true); }}><Plus className="size-4" />{t("addOperator")}</Button>
            </WorkbenchCard> : <div className="grid min-w-0 gap-3">
              {goals.map((goal) => {
                const operator = OPERATOR_BY_ID.get(goal.operatorId);
                const costs = plannerData.operators[goal.operatorId];
                if (!operator || !costs) return null;
                const name = localizedOperatorName(operator.name, locale, gameCatalog);
                const maxElite = maxEliteForRarity(operator.rarity);
                const currentEliteOptions = Array.from({ length: maxElite + 1 }, (_, index) => index);
                const targetLevelMax = manualLevelFor(operator.rarity, goal.targetElite);
                const currentLevelMax = manualLevelFor(operator.rarity, goal.currentElite);
                const modulesAvailable = costs.modules;
                return <article key={goal.operatorId} className="grid min-w-0 gap-3 border border-border bg-card p-3 sm:p-4" data-training-goal={goal.operatorId}>
                  <div className="flex min-w-0 items-start gap-3">
                    <OperatorIdentity name={operator.name} portrait={operator.portrait} compact>
                      <span className="font-number text-xs text-muted-foreground">{operator.rarity}★ · {currentById.get(operator.id)?.own ? t("current") : ""}</span>
                    </OperatorIdentity>
                    <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={() => updateGoals((current) => current.filter((entry) => entry.operatorId !== goal.operatorId))} aria-label={t("remove", { name })} title={t("remove", { name })}>
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                      <label className="col-span-2 text-xs font-medium text-muted-foreground">{t("current")}</label>
                      {selectElement(t("elite", { level: goal.currentElite }), goal.currentElite, (next) => updateGoal(operator.id, (entry) => ({ ...entry, currentElite: next, currentLevel: Math.min(entry.currentLevel, manualLevelFor(operator.rarity, next)) })), currentEliteOptions)}
                      {selectElement(t("changeLevel"), goal.currentLevel, (next) => updateGoal(operator.id, (entry) => ({ ...entry, currentLevel: next })), Array.from({ length: currentLevelMax }, (_, index) => index + 1))}
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                      <label className="col-span-2 text-xs font-medium text-muted-foreground">{t("target")}</label>
                      {selectElement(t("elite", { level: goal.targetElite }), goal.targetElite, (next) => updateGoal(operator.id, (entry) => ({ ...entry, targetElite: next, targetLevel: Math.min(entry.targetLevel, manualLevelFor(operator.rarity, next)) })), currentEliteOptions)}
                      {selectElement(t("changeLevel"), goal.targetLevel, (next) => updateGoal(operator.id, (entry) => ({ ...entry, targetLevel: next })), Array.from({ length: targetLevelMax }, (_, index) => index + 1))}
                    </div>
                  </div>
                  <details className="border-t border-border pt-2">
                    <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-xs font-medium">
                      <span>{t("costDetails")}</span><ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                    </summary>
                    <div className="grid min-w-0 gap-4 pt-2">
                      <div className="grid grid-cols-2 gap-2">
                        {selectElement(t("skillLevel"), goal.currentSkillLevel, (next) => updateGoal(operator.id, (entry) => ({ ...entry, currentSkillLevel: next })), Array.from({ length: 7 }, (_, index) => index + 1), !costs.skillLevels.length)}
                        {selectElement(t("targetSkill"), goal.targetSkillLevel, (next) => updateGoal(operator.id, (entry) => ({ ...entry, targetSkillLevel: next })), Array.from({ length: 7 }, (_, index) => index + 1), !costs.skillLevels.length)}
                      </div>
                      {costs.skills.map((skill, index) => {
                        const current = goal.currentMasteries[skill.id] ?? 0;
                        const target = goal.targetMasteries[skill.id] ?? current;
                        return <div key={skill.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
                          <span className="pb-2 text-xs text-muted-foreground">{t("masterySkill", { index: index + 1 })}</span>
                          {selectElement(t("targetMastery"), target, (next) => updateGoal(operator.id, (entry) => ({ ...entry, targetMasteries: { ...entry.targetMasteries, [skill.id]: next } })), [0, 1, 2, 3], goal.targetElite < 2)}
                          <span className="col-span-2 text-[11px] text-muted-foreground">{t("current")}: {t("masteryLevel", { level: current })}</span>
                        </div>;
                      })}
                      {modulesAvailable.length ? <div className="grid gap-2 border-t border-border pt-3">
                        <h3 className="text-xs font-medium">{t("moduleTargets")}</h3>
                        {modulesAvailable.map((module) => {
                          const current = goal.currentModules[module.id] ?? 0;
                          const target = goal.targetModules[module.id] ?? current;
                          const available = goal.targetElite === 2 && goal.targetLevel >= module.unlockLevel;
                          return <div key={module.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem] items-center gap-2">
                            <span className="min-w-0 text-xs leading-5"><span className="block break-words">{module.name}</span><span className="text-muted-foreground">{t("current")}: {t("moduleLevel", { level: current })}</span></span>
                            {selectElement(t("moduleTargets"), target, (next) => updateGoal(operator.id, (entry) => {
                              const targets = { ...entry.targetModules };
                              if (next <= (entry.currentModules[module.id] ?? 0)) delete targets[module.id];
                              else targets[module.id] = next;
                              return { ...entry, targetModules: targets };
                            }), [0, 1, 2, 3], !available)}
                            {!available && target > current ? <span className="col-span-2 text-[11px] text-amber-700">{t("moduleLockedUntil", { level: module.unlockLevel })}</span> : null}
                          </div>;
                        })}
                      </div> : <p className="text-xs text-muted-foreground">{t("noModules")}</p>}
                      <p className="text-xs leading-5 text-muted-foreground">{t("costSourceNote")}</p>
                    </div>
                  </details>
                </article>;
              })}
            </div>}
          </section>

          <section className="min-w-0 border-t border-border pt-4" aria-labelledby="training-stock-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="training-stock-heading" className="text-base font-semibold">{t("resourceStock")}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" role="status" aria-live="polite">
                <span>{inventoryLoading ? t("loadingInventory") : inventoryError ? t("inventoryUnavailable") : inventoryFetched ? t("inventoryReady") : t("inventoryUnavailable")}</span>
                {!inventoryLoading && inventorySaveFailed ? <span className="text-destructive">{t("inventorySaveFailed")}</span> : null}
                {!inventoryLoading && inventoryFetched && !inventorySaveFailed ? <span>{t("inventorySaved")}</span> : null}
              </div>
            </div>
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {[...MONEY_IDS, ...BOOK_IDS].map((id) => {
                const item = plannerData.items[id];
                return <label key={id} className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_6rem] items-center gap-2 border-b border-border/70 py-2">
                  {item?.icon ? <img src={item.icon} alt="" width={36} height={36} className="size-9 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                  <span className="min-w-0 text-xs leading-5">{inventoryLabel(id, t, gameCatalog.itemNames)}<span className="block text-muted-foreground">{t("stock")}</span></span>
                  <Input type="number" min={0} step={1} inputMode="numeric" className="h-9 px-2 text-right font-number text-xs" value={countFor(id)} onChange={(event) => setInventoryCount(id, event.target.value)} aria-label={`${inventoryLabel(id, t, gameCatalog.itemNames)} ${t("stock")}`} />
                </label>;
              })}
            </div>
            <details className="mt-4 border-t border-border pt-2">
              <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                <span>{t("materialStock")} · {MATERIAL_IDS.length}</span><ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              </summary>
              <div className="grid min-w-0 gap-3 pt-3">
                <label className="relative block max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder={t("filterItems")} aria-label={t("filterItems")} className="h-9 pl-9" />
                </label>
                <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleMaterials.map((id) => {
                    const item = plannerData.items[id];
                    if (!item) return null;
                    return <label key={id} className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_5.5rem] items-center gap-2 border-b border-border/70 py-1.5">
                      {item.icon ? <img src={item.icon} alt="" width={36} height={36} loading="lazy" className="size-9 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                      <span className="min-w-0 break-words text-xs leading-4">{gameCatalog.itemNames[id] ?? item.name}</span>
                      <Input type="number" min={0} step={1} inputMode="numeric" className="h-9 px-2 text-right font-number text-xs" value={countFor(id)} onChange={(event) => setInventoryCount(id, event.target.value)} aria-label={`${gameCatalog.itemNames[id] ?? item.name} ${t("stock")}`} />
                    </label>;
                  })}
                </div>
              </div>
            </details>
          </section>
        </div>

        <aside className="grid min-w-0 content-start gap-6 xl:sticky xl:top-5 xl:self-start" aria-labelledby="training-results-heading">
          <section className="min-w-0">
            <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
              <span className="h-5 w-1 bg-[#22BBFF]" aria-hidden="true" />
              <h2 id="training-results-heading" className="text-base font-semibold">{t("resourceSummary")}</h2>
              <span className="ml-auto text-xs text-muted-foreground">{t("selected", { count: result.goals })}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <div className="grid gap-2 border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">{t("lmd")}</span>
                <strong className="font-number text-lg">{numberText(result.lmd)}</strong>
                <span className={cn("text-xs", result.lmdMissing ? "text-amber-700" : "text-emerald-700")}>{result.lmdMissing ? t("lmdMissing", { count: numberText(result.lmdMissing) }) : t("available")}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">{t("withGoldBars")} · {numberText(result.lmdStockWithGoldBars)}</span>
              </div>
              <div className="grid gap-2 border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">{t("experience")}</span>
                <strong className="font-number text-lg">{numberText(result.experience)}</strong>
                <span className={cn("text-xs", result.experienceMissing ? "text-amber-700" : "text-emerald-700")}>{result.experienceMissing ? t("experienceMissing", { count: numberText(result.experienceMissing) }) : t("available")}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">{t("bookEquivalent", { count: result.experienceBooksEquivalent })}</span>
              </div>
              <div className="grid gap-2 border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">{t("materialShortages")}</span>
                <strong className="font-number text-lg">{result.shortages.length}</strong>
                <span className={cn("text-xs", result.shortages.length ? "text-amber-700" : "text-emerald-700")}>{result.shortages.length ? t("shortage") : t("available")}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">{numberText(result.crafts.length)} {t("craftingPlan")}</span>
              </div>
            </div>
          </section>

          <section className="min-w-0" aria-labelledby="training-shortages-heading">
            <h2 id="training-shortages-heading" className="mb-2 border-b border-border pb-2 text-sm font-semibold">{t("materialShortages")}</h2>
            {result.shortages.length ? <div className="grid min-w-0">
              {result.shortages.map((item) => <div key={item.id} className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-2 border-b border-border/70 py-2">
                {item.icon ? <img src={item.icon} alt="" width={36} height={36} className="size-9 object-contain" /> : <PackageOpen className="m-2 size-5 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between gap-2 text-xs"><span className="min-w-0 break-words font-medium">{item.name}</span><strong className="font-number shrink-0 text-amber-700">−{numberText(item.missing)}</strong></div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("needOwnedMissing", { need: numberText(item.need), stock: numberText(item.stock), missing: numberText(item.missing) })}</p>
                  {item.drops.length ? <p className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">{t("dropSources")}: {item.drops.join(" · ")}</p> : null}
                </div>
              </div>)}
            </div> : <p className="py-4 text-sm text-muted-foreground">{t("noMaterialShortages")}</p>}
          </section>

          <section className="min-w-0" aria-labelledby="training-crafts-heading">
            <h2 id="training-crafts-heading" className="mb-2 border-b border-border pb-2 text-sm font-semibold">{t("craftingPlan")}</h2>
            {result.crafts.length ? <div className="grid min-w-0">
              {result.crafts.map((craft, index) => <div key={`${craft.id}-${index}`} className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-2 border-b border-border/70 py-2">
                {craft.icon ? <img src={craft.icon} alt="" width={36} height={36} className="size-9 object-contain" /> : <PackageOpen className="m-2 size-5 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className="break-words text-xs font-medium">{gameCatalog.itemNames[craft.id] ?? craft.name} ×{numberText(craft.count)}</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("craftEntry", { count: craft.count, facility: craft.facility === "WORKSHOP" ? t("workshop") : t("manufacture"), level: craft.level })}</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("craftCost", { count: numberText(craft.lmd) })}</p>
                </div>
              </div>)}
            </div> : <p className="py-3 text-sm text-muted-foreground">{t("noCrafts")}</p>}
          </section>

          <section className="min-w-0 border-t border-border pt-4" aria-labelledby="training-acquisition-heading">
            <h2 id="training-acquisition-heading" className="text-sm font-semibold">{t("dailyEstimate")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("dailyEstimateNote")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <label className="grid gap-1 text-xs text-muted-foreground">{t("lmdPerDay")}<Input type="number" min={0} step={1000} value={dailyLmd || ""} onChange={(event) => setDailyLmd(Math.max(0, Number(event.target.value) || 0))} /></label>
              <label className="grid gap-1 text-xs text-muted-foreground">{t("experiencePerDay")}<Input type="number" min={0} step={1000} value={dailyExperience || ""} onChange={(event) => setDailyExperience(Math.max(0, Number(event.target.value) || 0))} /></label>
            </div>
            <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
              <p>{t("lmd")}: {result.lmdMissing ? dailyLmd ? t("days", { count: Math.ceil(result.lmdMissing / dailyLmd) }) : t("daysUnknown") : t("available")}</p>
              <p>{t("experience")}: {result.experienceMissing ? dailyExperience ? t("days", { count: Math.ceil(result.experienceMissing / dailyExperience) }) : t("daysUnknown") : t("available")}</p>
            </div>
          </section>
          <p className="text-[11px] leading-5 text-muted-foreground">{t("sourceNote", { commit: plannerData.source.commit.slice(0, 12) })}</p>
          {planSaveFailed ? <p role="status" className="text-xs text-destructive">{t("saveError")}</p> : null}
          {inventory.pending ? <p className="sr-only" role="status">{t("stale")}</p> : null}
        </aside>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[min(920px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{t("chooseOperators")}</DialogTitle>
            <DialogDescription>{t("chooseDescription")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-hidden pb-4">
            <Tabs value={pickerTab} onValueChange={(value) => { setPickerTab(value); setVisibleLimit(OPERATOR_PAGE_SIZE); }}>
              <TabsList aria-label={t("chooseOperators")}>
                <TabsTrigger value="box">{t("currentBox")}</TabsTrigger>
                <TabsTrigger value="all">{t("allOperators")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <OperatorSearch value={query} onChange={(value) => { setQuery(value); setVisibleLimit(OPERATOR_PAGE_SIZE); }} compact label={t("search")} placeholder={t("search")} />
              <OperatorRarityFilter value={rarity} onChange={(value) => { setRarity(value); setVisibleLimit(OPERATOR_PAGE_SIZE); }} />
            </div>
            <OperatorProfessionFilter value={profession} onChange={(value) => { setProfession(value); setVisibleLimit(OPERATOR_PAGE_SIZE); }} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {pickerTab === "box" && !currentRoster.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("noBox")}</p> : <OperatorRosterGrid compact hasMore={visibleLimit < filteredRoster.length} onLoadMore={() => setVisibleLimit((current) => current + OPERATOR_PAGE_SIZE)}>
                {filteredRoster.slice(0, visibleLimit).map((operator) => {
                  const isSelected = goals.some((goal) => goal.operatorId === operator.id);
                  return <button key={operator.id} type="button" onClick={() => addOperator(operator)} aria-pressed={isSelected} className={cn("flex min-w-0 items-center gap-3 border p-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", isSelected ? "border-[#B8F03A] bg-[#B8F03A]/10" : "border-border/70")}>
                    <OperatorIdentity name={operator.name} portrait={operator.portrait} compact><span className="font-number text-xs text-muted-foreground">{operator.rarity}★</span></OperatorIdentity>
                    {isSelected ? <Check className="ml-auto size-4 shrink-0 text-emerald-700" /> : <Plus className="ml-auto size-4 shrink-0 text-muted-foreground" />}
                  </button>;
                })}
              </OperatorRosterGrid>}
            </div>
          </DialogBody>
          <DialogFooter><Button type="button" onClick={() => setPickerOpen(false)}>{t("selected", { count: goals.length })}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
