"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { localize as localize_components_skill_query_SkillResultRow } from "../../i18n/helpers/components_skill_query_SkillResultRow.ts";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichText } from "@/components/RichText";
import { BUILDING_SKILL_CATALOG, buildingSkillUnlockLabel, isBuildingSkillEnhanced, type OperatorBuildingSkillRef } from "@/operatorPortraits";
import { skillAnnotationKey } from "@/skill-annotations";
import type { SkillAnnotationData } from "@riic/arknights-domain/types";
import { localizedBuildingSkill } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { BuildingSkillUnlockText, SkillAnnotationNote } from "./SkillText";

export default function MobileSkillList({
  operatorId,
  skills,
  annotationIndex,
}: {
  operatorId: string;
  skills: OperatorBuildingSkillRef[];
  annotationIndex: ReadonlyMap<string, SkillAnnotationData>;
}) {
  const intl = useTranslations();
  const [selected, setSelected] = useState<OperatorBuildingSkillRef | null>(null);
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {skills.length ? (
        skills.map((ref) => {
          const sourceSkill = BUILDING_SKILL_CATALOG[ref.id];
          const skill = sourceSkill ? localizedBuildingSkill(ref.id, locale, sourceSkill, gameCatalog) : undefined;
          const annotation = annotationIndex.get(skillAnnotationKey(operatorId, ref.id))?.note;
          return (
            <button
              key={ref.id}
              type="button"
              onClick={() => setSelected(ref)}
              className="flex min-h-11 flex-col items-start justify-center rounded-lg border border-white/10 bg-black/24 px-2.5 py-2 text-left text-sm font-medium text-white outline-none transition-colors hover:bg-black/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFD800]"
              aria-label={localize_components_skill_query_SkillResultRow.text(en, "additional1", { choice4: ((skill) ? ("yes") : ("no")), value5: (((skill)) ? (String(ref.index)) : ("")), value6: (((skill)) ? (String(skill.name)) : ("")) })}
            >
              {skill ? (
                <span className="flex min-w-0 items-center gap-2">
                  <img src={skill.icon} alt="" className="size-7 shrink-0 object-contain" aria-hidden="true" />
                  <span className="truncate">
                    {skill.name}
                  </span>
                </span>
              ) : (
                <span className="text-white/55">
                  S<span className="font-number">{ref.index}</span> {intl("components_skill_query_SkillResultRow.noSkillData")}
                </span>
              )}
              {annotation ? <SkillAnnotationNote note={annotation} /> : null}
            </button>
          );
        })
      ) : (
        <span className="text-sm text-white/55">{intl("components_skill_query_SkillResultRow.noSkillData")}</span>
      )}
      <SkillDetailDialog
        selected={selected}
        enhanced={selected !== null ? isBuildingSkillEnhanced(skills, selected) : false}
        annotation={selected ? annotationIndex.get(skillAnnotationKey(operatorId, selected.id))?.note : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function SkillDetailDialog({
  selected,
  enhanced,
  annotation,
  onClose,
}: {
  selected: OperatorBuildingSkillRef | null;
  enhanced: boolean;
  annotation?: string;
  onClose: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();

  const sourceSkill = selected ? BUILDING_SKILL_CATALOG[selected.id] : undefined;
  const skill = selected && sourceSkill ? localizedBuildingSkill(selected.id, locale, sourceSkill, gameCatalog) : undefined;
  const unlockLabel = selected ? buildingSkillUnlockLabel(selected.elite, selected.level, enhanced, locale) : "";

  return (
    <Dialog
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader className=" pb-0">
          <DialogTitle>
            {skill ? (
              <span className="flex min-w-0 items-center gap-2">
                <img src={skill.icon} alt="" className="size-7 shrink-0 object-contain" aria-hidden="true" />
                <span className="truncate">
                  {skill.name}
                </span>
              </span>
            ) : (
              <span>
                S<span className="font-number">{selected?.index}</span> {intl("components_skill_query_SkillResultRow.noSkillData")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-2">
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>
              {selected ? (
                <BuildingSkillUnlockText elite={selected.elite} level={selected.level} enhanced={enhanced} />
              ) : (
                unlockLabel
              )}
            </span>
          </div>
          {skill ? (
            <p className="text-pretty text-sm leading-6 text-foreground">
              {skill.descriptionRich ? <RichText text={skill.descriptionRich} /> : skill.description}
            </p>
          ) : null}
          {annotation ? <SkillAnnotationNote note={annotation} light /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
