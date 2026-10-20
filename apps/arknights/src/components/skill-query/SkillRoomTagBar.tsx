"use client";

import { useTranslations } from "use-intl";
import { BUILDING_ROOM_PREFIXES, type BuildingRoomPrefix } from "@/building-rooms";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SkillRoomTagBar({ selected, onChange }: {
  selected: BuildingRoomPrefix | null;
  onChange: (next: BuildingRoomPrefix | null) => void;
}) {
  const t = useTranslations("Rooms");
  const filters = useTranslations("SkillFilters");
  return (
    <Tabs value={selected ?? "all"} onValueChange={(value) => onChange(value === "all" ? null : value as BuildingRoomPrefix)}>
      <TabsList aria-label={filters("room")}>
        <TabsTrigger value="all">{filters("all")}</TabsTrigger>
        {BUILDING_ROOM_PREFIXES.map((prefix) => <TabsTrigger key={prefix} value={prefix}>{t(prefix)}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}
