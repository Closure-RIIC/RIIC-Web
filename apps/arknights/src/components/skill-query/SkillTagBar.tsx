"use client";

import { useTranslations } from "use-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type messages from "../../../messages/zh-CN/SkillTags.json";

export function SkillTagBar({ tags, selected, onChange }: {
  tags: readonly string[];
  selected: string | null;
  onChange: (next: string | null) => void;
}) {
  const t = useTranslations("SkillTags");
  const filters = useTranslations("SkillFilters");
  return (
    <Tabs value={selected ?? "all"} onValueChange={(value) => onChange(value === "all" ? null : value)}>
      <TabsList aria-label={filters("tag")}>
        <TabsTrigger value="all">{filters("all")}</TabsTrigger>
        {tags.map((tag) => <TabsTrigger key={tag} value={tag}>{t(tag as keyof typeof messages)}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}
