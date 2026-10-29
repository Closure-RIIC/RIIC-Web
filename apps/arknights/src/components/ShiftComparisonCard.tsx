"use client";

import type { AppLocale } from "@riic/contracts/locale";
import { localize as localize_components_ShiftComparisonCard } from "../i18n/helpers/components_ShiftComparisonCard.ts";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import type { CSSProperties, ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";
import { roomLightAccentFor } from "@/room-visuals";
import type { ShiftAdjustment, ShiftAdjustmentIssue, ShiftComparison } from "@riic/arknights-domain/types";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

const ACTION_ISSUES = ["unexpected", "missing", "misplaced"] as const;
type ActionIssue = typeof ACTION_ISSUES[number];

function roomKeyParts(key: string | null, en: AppLocale) {
  if (!key) return { group: "default", label: localize_components_ShiftComparisonCard.text(en, "unassigned") };
  const [group, indexText] = key.split(":");
  const labels = messageRecord(en, "components_ShiftComparisonCard_labels");
  const groupLabel = labels[group] ?? (localize_components_ShiftComparisonCard.text(en, "unknownFacility"));
  const index = Number(indexText);
  return {
    group: labels[group] ? group : "default",
    label: group === "control" ? groupLabel : `${groupLabel} ${Number.isFinite(index) ? index + 1 : indexText}`,
  };
}

export function roomKeyLabel(key: string | null, locale: AppLocale) {
  return roomKeyParts(key, locale).label;
}

function issueTone(issue: ShiftAdjustmentIssue) {
  if (issue === "tired") return "bg-red-100 text-red-800";
  if (issue === "missing") return "bg-sky-100 text-sky-800";
  if (issue === "unexpected") return "bg-amber-100 text-amber-800";
  return "bg-zinc-200 text-zinc-800";
}

function IssueLabel({ issue }: { issue: ShiftAdjustmentIssue }) {
  const locale = useLocale();
  return <span className={cn("inline-flex px-2 py-1 text-xs font-semibold", issueTone(issue))}>{(messageRecord(locale, "components_ShiftComparisonCard_labels2"))[issue]}</span>;
}

function RoomLabel({ roomKey }: { roomKey: string | null }) {
  const locale = useLocale();
  const room = roomKeyParts(roomKey, locale);
  const accent = roomLightAccentFor(room.group);
  const style = {
    "--comparison-room-accent": accent,
  } as CSSProperties;

  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-medium text-zinc-800"
      data-room-label
      data-room-group={room.group}
      style={style}
    >
      <span className="h-3 w-1 shrink-0 bg-[var(--comparison-room-accent)]" data-room-indicator aria-hidden="true" />
      <span className="truncate">{room.label}</span>
    </span>
  );
}

function OperatorName({ adjustment, className }: { adjustment: ShiftAdjustment; className?: string }) {
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <strong className="min-w-0 truncate">{localizedOperatorName(adjustment.operator, locale, gameCatalog)}</strong>
      {adjustment.issues.includes("tired") ? <IssueLabel issue="tired" /> : null}
    </div>
  );
}

function ActionDescription({ adjustment, issue }: { adjustment: ShiftAdjustment; issue: ActionIssue }) {
  const intl = useTranslations();

  if (issue === "unexpected") return <div className="flex min-w-0 items-center gap-1.5"><span>{intl("components_ShiftComparisonCard.from")}</span><RoomLabel roomKey={adjustment.currentRoomKey} /><span>{intl("components_ShiftComparisonCard.moveOut")}</span></div>;
  if (issue === "missing") return <div className="flex min-w-0 items-center gap-1.5"><span>{intl("components_ShiftComparisonCard.moveInto")}</span><RoomLabel roomKey={adjustment.targetRoomKey} /></div>;
  return <div className="flex min-w-0 items-center gap-1.5"><RoomLabel roomKey={adjustment.currentRoomKey} /><span aria-hidden="true">→</span><RoomLabel roomKey={adjustment.targetRoomKey} /></div>;
}

function EmptyGroup() {
  const intl = useTranslations();

  return <p className="mt-2 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">{intl("components_ShiftComparisonCard.none")}</p>;
}

function GroupHeading({ issue, count, id }: { issue: ActionIssue; count: number; id: string }) {
  const locale = useLocale();
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 id={id}><IssueLabel issue={issue} /></h4>
      <span className="font-number text-xs text-muted-foreground">{localize_components_ShiftComparisonCard.text(locale, "additional1", { count })}</span>
    </div>
  );
}

function MobileAdjustmentGroups({ adjustments, reduceMotion }: { adjustments: ShiftAdjustment[]; reduceMotion: boolean }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale;
  const tiredOnly = adjustments.filter((adjustment) => adjustment.issues.includes("tired") && !ACTION_ISSUES.some((issue) => adjustment.issues.includes(issue)));

  return (
    <div className="mt-5 grid gap-5 sm:hidden" aria-label={intl("components_ShiftComparisonCard.shiftChangeSummary")} data-mobile-adjustment-groups>
      {ACTION_ISSUES.map((issue) => {
        const items = adjustments.filter((adjustment) => adjustment.issues.includes(issue));
        const headingId = `mobile-adjustment-${issue}`;
        return (
          <section key={issue} aria-labelledby={headingId} data-adjustment-group={issue}>
            <GroupHeading issue={issue} count={items.length} id={headingId} />
            {items.length ? (
              <ul className="mt-2 grid gap-2">
                {items.map((adjustment, index) => (
                  <motion.li
                    key={adjustment.operator}
                    className="flex min-w-0 items-center gap-3 bg-muted/45 px-3 py-3"
                    data-mobile-adjustment-row
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduceMotion ? 0 : MOTION_DURATION.content, delay: reduceMotion ? 0 : index * 0.035, ease: MOTION_EASE_OUT }}
                  >
                    <OperatorName adjustment={adjustment} className="max-w-[38%] shrink-0 text-sm" />
                    <div className="ml-auto min-w-0 text-xs text-muted-foreground" data-mobile-adjustment-action><ActionDescription adjustment={adjustment} issue={issue} /></div>
                  </motion.li>
                ))}
              </ul>
            ) : <EmptyGroup />}
          </section>
        );
      })}
      {tiredOnly.length ? (
        <section aria-labelledby="mobile-adjustment-tired" data-adjustment-group="tired">
          <div className="flex items-center justify-between gap-3">
            <h4 id="mobile-adjustment-tired"><IssueLabel issue="tired" /></h4>
            <span className="font-number text-xs text-muted-foreground">{localize_components_ShiftComparisonCard.text(en, "additional2", { count: tiredOnly.length })}</span>
          </div>
          <p className="mt-2 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800">{tiredOnly.map((adjustment) => localizedOperatorName(adjustment.operator, locale, gameCatalog)).join(intl("components_ShiftComparisonCard.label"))}</p>
        </section>
      ) : null}
    </div>
  );
}

function DesktopCells({ adjustment, issue }: { adjustment: ShiftAdjustment; issue: ActionIssue }) {
  if (issue === "unexpected") return <><td className="px-3 py-3"><OperatorName adjustment={adjustment} /></td><td className="px-3 py-3"><RoomLabel roomKey={adjustment.currentRoomKey} /></td></>;
  if (issue === "missing") return <><td className="px-3 py-3"><OperatorName adjustment={adjustment} /></td><td className="px-3 py-3"><RoomLabel roomKey={adjustment.targetRoomKey} /></td></>;
  return <><td className="px-3 py-3"><OperatorName adjustment={adjustment} /></td><td className="px-3 py-3"><RoomLabel roomKey={adjustment.currentRoomKey} /></td><td className="px-3 py-3"><RoomLabel roomKey={adjustment.targetRoomKey} /></td></>;
}

function DesktopTable({ items, issue, reduceMotion }: { items: ShiftAdjustment[]; issue: ActionIssue; reduceMotion: boolean }) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const roomHeaders: ReactNode = issue === "misplaced"
    ? <><th className="px-3 py-2 text-left font-medium">{intl("components_ShiftComparisonCard.currentRoom")}</th><th className="px-3 py-2 text-left font-medium">{intl("components_ShiftComparisonCard.targetRoom")}</th></>
    : <th className="px-3 py-2 text-left font-medium">{issue === "unexpected" ? (intl("components_ShiftComparisonCard.currentRoom")) : (intl("components_ShiftComparisonCard.targetRoom"))}</th>;

  return (
    <table className="mt-2 w-full table-fixed border-collapse" aria-label={intl("components_ShiftComparisonCard.operatorAdjustments", { value2: messageRecord(en, "components_ShiftComparisonCard_labels2")[issue] })} data-desktop-adjustment-table={issue}>
      <colgroup>
        <col style={{ width: issue === "misplaced" ? "28%" : "38%" }} />
        <col style={{ width: issue === "misplaced" ? "36%" : "62%" }} />
        {issue === "misplaced" ? <col style={{ width: "36%" }} /> : null}
      </colgroup>
      <thead className="border-y border-border/70 bg-muted/45 text-xs font-medium text-muted-foreground">
        <tr><th className="px-3 py-2 text-left font-medium">{intl("components_ShiftComparisonCard.operator")}</th>{roomHeaders}</tr>
      </thead>
      <tbody>
        {items.map((adjustment, index) => (
          <motion.tr
            key={adjustment.operator}
            className="border-b border-border/60 align-middle"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : MOTION_DURATION.content, delay: reduceMotion ? 0 : index * 0.035, ease: MOTION_EASE_OUT }}
          >
            <DesktopCells adjustment={adjustment} issue={issue} />
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}

function DesktopAdjustmentGroups({ adjustments, reduceMotion }: { adjustments: ShiftAdjustment[]; reduceMotion: boolean }) {
  const intl = useTranslations();

  return (
    <div className="mt-5 hidden gap-6 sm:grid" aria-label={intl("components_ShiftComparisonCard.operatorRoomAdjustmentsGroupedByAction")} data-desktop-adjustment-groups>
      {ACTION_ISSUES.map((issue) => {
        const items = adjustments.filter((adjustment) => adjustment.issues.includes(issue));
        const headingId = `desktop-adjustment-${issue}`;
        return (
          <section key={issue} aria-labelledby={headingId} data-adjustment-group={issue}>
            <GroupHeading issue={issue} count={items.length} id={headingId} />
            {items.length ? <DesktopTable items={items} issue={issue} reduceMotion={reduceMotion} /> : <EmptyGroup />}
          </section>
        );
      })}
    </div>
  );
}

export function ShiftComparisonDetails({ comparison }: { comparison: ShiftComparison | null }) {
  const intl = useTranslations();
  const reduceMotion = useReducedMotion();
  if (!comparison) return null;
  const exactMatch = comparison.adjustments.length === 0;
  return (
    <section className="pt-4 text-sm" aria-labelledby="closest-shift-title" data-shift-comparison-details>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2"><div><span className="text-xs font-medium text-muted-foreground">{intl("components_ShiftComparisonCard.currentStateMatch")}</span><h3 id="closest-shift-title" className="mt-0.5 text-base font-semibold">{intl.rich("components_ShiftComparisonCard.closestToShift", { number: comparison.planIndex + 1, shiftNumber: (chunks) => <span className="font-number">{chunks}</span> })}</h3></div><div className="text-right"><span className="text-xs text-muted-foreground">{intl("components_ShiftComparisonCard.nonDormitoryMatch")}</span><strong className="ml-2 text-lg tabular-nums">{comparison.score}%</strong></div></div>
      <div className="mt-3 h-1.5 overflow-hidden bg-border/70" role="progressbar" aria-label={intl("components_ShiftComparisonCard.nonDormitoryFacilityMatchPercentage")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={comparison.score}><div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, comparison.score))}%` }} /></div>
      {exactMatch ? (
        <div className="mt-5 flex gap-3 border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-900" role="status"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><strong className="block">{intl("components_ShiftComparisonCard.currentNonDormitoryAssignmentsMatchThisShiftExactly")}</strong><span className="mt-1 block text-xs text-emerald-800/75">{intl("components_ShiftComparisonCard.noNonDormitoryOperatorNeedsToMoveInMove")}</span></div></div>
      ) : (
        <>
          <MobileAdjustmentGroups adjustments={comparison.adjustments} reduceMotion={Boolean(reduceMotion)} />
          <DesktopAdjustmentGroups adjustments={comparison.adjustments} reduceMotion={Boolean(reduceMotion)} />
        </>
      )}
    </section>
  );
}
