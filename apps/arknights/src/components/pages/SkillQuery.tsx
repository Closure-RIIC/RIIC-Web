"use client";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { useTranslations } from "use-intl";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

import { filterOperators, ROOM_SKILL_TAGS, type BuildingRoomPrefix } from "@/building-rooms";
import { SkillTagBar } from "@/components/skill-query/SkillTagBar";
import { SkillResultRow } from "@/components/skill-query/SkillResultRow";
import { SkillRoomTagBar } from "@/components/skill-query/SkillRoomTagBar";
import { SkillFilterRow } from "@/components/skill-query/SkillFilterRow";
import { OperatorRarityFilter, OperatorProfessionFilter } from "@/components/operators/OperatorPickerParts";
import { Button } from "@/components/ui/button";
import { SearchInput } from "../../../../../packages/ui-primitives/search-input";
import { LoadMore } from "@/components/ui/load-more";
import { BUILDING_SKILL_CATALOG, OPERATOR_CATALOG } from "@/operatorPortraits";
import { useGameCatalog } from "@/i18n/game-data-client";
import { indexSkillAnnotations } from "@/skill-annotations";
import type { ApiResponse, SkillAnnotationListData } from "@/types";
import { DEFAULT_USER_SETTINGS, loadUserSettings } from "@/user-settings";

export const SKILL_QUERY_PAGE_SIZE = 10;

export function SkillQuery() {
  const intl = useTranslations();
  const gameCatalog = useGameCatalog();
  const [pinyinNames, setPinyinNames] = useState<Readonly<Record<string, readonly string[]>>>();
  useEffect(() => {
    let active = true;
    void import("@/generated/arkntools/operator-pinyin.json").then((module) => {
      if (active) setPinyinNames(module.default);
    });
    return () => { active = false; };
  }, []);

  const filters = useTranslations("SkillFilters");
  const [rarity, setRarity] = useState("all");
  const [profession, setProfession] = useState("all");
  const [selectedRoom, setSelectedRoom] = useState<BuildingRoomPrefix | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(SKILL_QUERY_PAGE_SIZE);
  const [annotations, setAnnotations] = useState<SkillAnnotationListData["annotations"]>([]);
  const [annotationError, setAnnotationError] = useState(false);
  const [annotationRequest, setAnnotationRequest] = useState(0);
  const [paginationMode, setPaginationMode] = useState<"infinite" | "manual">(DEFAULT_USER_SETTINGS.skillPagination);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setPaginationMode(loadUserSettings(window.localStorage).skillPagination);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAnnotationError(false);
    void fetch("/api/skill-annotations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ApiResponse<SkillAnnotationListData>;
        if (!response.ok || !body.success) throw new Error("skill annotations unavailable");
        setAnnotations(body.data.annotations);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnnotationError(true);
      });
    return () => controller.abort();
  }, [annotationRequest]);

  const availableTags = selectedRoom ? ROOM_SKILL_TAGS[selectedRoom] : [];
  const filtered = useMemo(
    () => filterOperators(
      OPERATOR_CATALOG,
      selectedRoom,
      selectedTag,
      query,
      (skillId) => BUILDING_SKILL_CATALOG[skillId],
      { rarity: rarity === "all" ? null : Number(rarity), profession: profession === "all" ? null : Number(profession), englishNames: gameCatalog?.operatorNames, pinyinNames },
    ),
    [query, selectedRoom, selectedTag, rarity, profession, gameCatalog, pinyinNames],
  );
  const visible = filtered.slice(0, visibleCount);
  const annotationIndex = useMemo(() => indexSkillAnnotations(annotations), [annotations]);
  const hasMore = visibleCount < filtered.length;
  const loadMore = useCallback(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const nextCount = Math.min(visibleCount + SKILL_QUERY_PAGE_SIZE, filtered.length);
    setVisibleCount(nextCount);
    return nextCount < filtered.length;
  }, [filtered.length, visibleCount]);

  function handleRoomChange(next: BuildingRoomPrefix | null) {
    setSelectedRoom(next);
    // 标签是房间的二级维度：切换房间时清空旧标签。
    setSelectedTag(null);
    setVisibleCount(SKILL_QUERY_PAGE_SIZE);
  }

  function handleTagChange(next: string | null) {
    setSelectedTag(next);
    setVisibleCount(SKILL_QUERY_PAGE_SIZE);
  }

  function handleClearFilters() {
    setRarity("all");
    setProfession("all");
    setSelectedRoom(null);
    setSelectedTag(null);
    setVisibleCount(SKILL_QUERY_PAGE_SIZE);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setVisibleCount(SKILL_QUERY_PAGE_SIZE);
  }

  function handleClearQuery() {
    handleQueryChange("");
    // 清空后把焦点还给输入框，方便直接继续输入
    searchInputRef.current?.focus();
  }

  return (
    <section className="min-w-0 pt-5" aria-label={intl("components_pages_SkillQuery.skillSearch")} data-skill-query-page>
      <div className="mb-2 flex min-w-0 items-center gap-2.5">
        <WorkbenchPageHeading page="skill-query">{intl("components_pages_SkillQuery.skillSearch")}</WorkbenchPageHeading>
        <span className="font-number text-xs text-muted-foreground" aria-live="polite">{filters("operators", { count: filtered.length })}</span>
        <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0"
          disabled={rarity === "all" && profession === "all" && !selectedRoom && !selectedTag}
          onClick={handleClearFilters} aria-label={filters("clear")}>
          <X aria-hidden="true" />{filters("clear")}
        </Button>
      </div>

      <div className="mt-3 grid min-w-0 gap-1" data-skill-filters>
        <SkillFilterRow label={filters("rarity")}>
          <OperatorRarityFilter value={rarity} onChange={(value) => { setRarity(value); setVisibleCount(SKILL_QUERY_PAGE_SIZE); }} />
        </SkillFilterRow>
        <SkillFilterRow label={filters("profession")}>
          <OperatorProfessionFilter value={profession} onChange={(value) => { setProfession(value); setVisibleCount(SKILL_QUERY_PAGE_SIZE); }} />
        </SkillFilterRow>
        <SkillFilterRow label={filters("room")}>
          <SkillRoomTagBar selected={selectedRoom} onChange={handleRoomChange} />
        </SkillFilterRow>
        <SkillFilterRow label={filters("tag")}>
          {selectedRoom && availableTags.length ? <SkillTagBar tags={availableTags} selected={selectedTag} onChange={handleTagChange} />
            : <p className="flex min-h-7 items-center text-xs text-muted-foreground max-sm:min-h-11">{filters(selectedRoom ? "noTags" : "chooseRoom")}</p>}
        </SkillFilterRow>
      </div>

      <SearchInput
          ref={searchInputRef}
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          containerClassName="mt-3"
          placeholder={intl("components_pages_SkillQuery.searchOperatorSkillNameOrEffect")}
          label={intl("components_pages_SkillQuery.searchOperatorSkillNameOrEffect")}
          onClear={handleClearQuery}
          clearLabel={intl("components_pages_SkillQuery.clearSearch")}
        />

      {annotationError ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-2 border-amber-400 bg-amber-400/8 px-3 py-2 text-sm text-muted-foreground" role="status">
          <span>{intl("components_pages_SkillQuery.manualSkillNotesCouldNotBeLoaded")}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAnnotationRequest((value) => value + 1)}>
            {intl("components_pages_SkillQuery.retryNotes")}
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{intl("components_pages_SkillQuery.noOperatorsMatchTheseFilters")}</p>
        ) : (
          <>
            <div className="grid gap-3">
              {visible.map((operator, index) => (
                <motion.div key={operator.id} initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.24, delay: shouldReduceMotion ? 0 : Math.min(index % SKILL_QUERY_PAGE_SIZE, 4) * 0.025 }}>
                  <SkillResultRow operator={operator} annotationIndex={annotationIndex} />
                </motion.div>
              ))}
            </div>
            <LoadMore
              key={`${query}:${rarity}:${profession}:${selectedRoom ?? ""}:${selectedTag ?? ""}`}
              hasMore={hasMore}
              auto={paginationMode === "infinite"}
              onLoad={loadMore}
              className="mt-4 border-t border-border/60 pt-2"
            />
          </>
        )}
      </div>
    </section>
  );
}
