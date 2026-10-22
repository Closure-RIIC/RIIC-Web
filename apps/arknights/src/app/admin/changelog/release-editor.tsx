"use client";

import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import type { ReleaseDraft, ReleaseSection, ReleaseText } from "@riic/arknights-domain/releases/types";
import { RELEASE_KINDS, RELEASE_LIMITS } from "@/releases/validation";

const SECTION_KEYS = { added: "sectionNew", improved: "sectionImproved", fixed: "sectionFixed" } as const;

export function ReleaseEditor({ draft, onChange, versionLocked, disabled }: {
  draft: ReleaseDraft; onChange: (draft: ReleaseDraft) => void; versionLocked: boolean; disabled: boolean;
}) {
  const t = useTranslations("ReleaseEditor");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  function setItems(kind: ReleaseSection["kind"], items: ReleaseText[]) {
    const sections = RELEASE_KINDS.flatMap((candidate) => {
      const values = candidate === kind ? items : draft.sections.find((section) => section.kind === candidate)?.items ?? [];
      return values.length ? [{ kind: candidate, items: values }] : [];
    });
    onChange({ ...draft, sections });
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="release-version">{t("version")}</Label>
          <Input id="release-version" className="h-11" value={draft.version} placeholder="0.6.1" maxLength={20}
            readOnly={versionLocked} aria-describedby={versionLocked ? "version-lock-hint" : undefined}
            onChange={(event) => onChange({ ...draft, version: event.target.value })} />
          {versionLocked ? <p id="version-lock-hint" className="text-xs text-muted-foreground">{t("versionLocked")}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="release-date">{t("releaseDate")}</Label>
          <Input id="release-date" type="date" className="h-11" value={draft.date}
            onChange={(event) => onChange({ ...draft, date: event.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Toggle variant="outline" pressed={draft.notify} onPressedChange={(notify) => onChange({ ...draft, notify })}
          className="h-11 px-4" aria-label={t("notifyInPopup")}>
          {draft.notify ? t("popupOn") : t("popupOff")}
        </Toggle>
        <p className="text-xs leading-5 text-muted-foreground">{t("notificationHint")}</p>
      </div>
      <Tabs value={language} onValueChange={(value) => setLanguage(value as "zh" | "en")}>
        <TabsList aria-label={t("contentLanguage")} className="h-11">
          <TabsTrigger value="zh">{t("chinese")}</TabsTrigger>
          <TabsTrigger value="en">{t("englishOptional")}</TabsTrigger>
        </TabsList>
      <TabsContent value={language} className="space-y-6 pt-3">
      {language === "en" ? <p className="text-xs text-muted-foreground">{t("englishFallback")}</p> : null}
      <div className="space-y-2">
        <Label htmlFor="release-title">{t("updateTitle")}</Label>
        <Input id="release-title" value={draft.title[language]} className="h-11" maxLength={RELEASE_LIMITS.title}
          placeholder={t("titlePlaceholder")}
          onChange={(event) => onChange({ ...draft, title: { ...draft.title, [language]: event.target.value } })} />
      </div>
      {RELEASE_KINDS.map((kind) => {
        const items = draft.sections.find((section) => section.kind === kind)?.items ?? [];
        return (
          <section key={kind} className="space-y-3 border-t border-border/70 pt-5" aria-label={t(SECTION_KEYS[kind])}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t(SECTION_KEYS[kind])}</h3>
              <Button type="button" variant="outline" disabled={items.length >= RELEASE_LIMITS.itemsPerSection} onClick={() => setItems(kind, [...items, { zh: "", en: "" }])}>
                {t("addItem")}
              </Button>
            </div>
            {!items.length ? <p className="text-xs text-muted-foreground">{t("noItems")}</p> : null}
            {items.map((item, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`release-${kind}-${index}`}>{t(SECTION_KEYS[kind])} {index + 1}</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setItems(kind, items.filter((_, itemIndex) => index !== itemIndex))}
                    aria-label={t("removeItemLabel", { section: t(SECTION_KEYS[kind]), index: index + 1 })}>{t("remove")}</Button>
                </div>
                <Textarea id={`release-${kind}-${index}`} value={item[language]} maxLength={RELEASE_LIMITS.item} className="min-h-24"
                  onChange={(event) => setItems(kind, items.map((entry, itemIndex) => index === itemIndex ? { ...entry, [language]: event.target.value } : entry))} />
              </div>
            ))}
          </section>
        );
      })}
      </TabsContent>
      </Tabs>
    </fieldset>
  );
}
