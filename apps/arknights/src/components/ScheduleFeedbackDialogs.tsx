"use client";

import { useTranslations, useLocale } from "use-intl";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { scheduleIssueTriggerId } from "@/components";
import type { RoomRow } from "@/schedule";
import type { FeedbackKind } from "@riic/arknights-domain/types";

const PLAN_RESULT_PRIMARY_TRIGGER_SELECTOR = "[data-plan-primary-details-trigger]";

export function IssueNoteModal({
  open,
  kind,
  row,
  note,
  saving,
  onNoteChange,
  onSave,
  onCancel,
}: {
  open: boolean;
  kind: FeedbackKind;
  row: RoomRow | null;
  note: string;
  saving: boolean;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const intl = useTranslations();

  const [consented, setConsented] = useState(false);
  const returnFocusId = useRef<string | null>(null);
  const returnToPlanSummary = useRef(false);
  const isPerformance = kind === "performance_issue";

  useEffect(() => {
    if (open) setConsented(false);
  }, [kind, open, row?.key]);

  useEffect(() => {
    if (row) {
      returnFocusId.current = scheduleIssueTriggerId(row);
      returnToPlanSummary.current = false;
    } else if (open && isPerformance) {
      returnFocusId.current = null;
      returnToPlanSummary.current = true;
    }
  }, [isPerformance, open, row]);

  return (
    <Dialog
      open={open && (isPerformance || Boolean(row))}
      triggerId={row ? scheduleIssueTriggerId(row) : null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent
        className="max-w-[min(620px,calc(100vw-2rem))] sm:max-w-xl"
        finalFocus={() => {
          if (returnFocusId.current) return document.getElementById(returnFocusId.current);
          if (returnToPlanSummary.current) return document.querySelector<HTMLElement>(PLAN_RESULT_PRIMARY_TRIGGER_SELECTOR) ?? true;
          return true;
        }}
      >
        <DialogHeader>
          <DialogTitle>{isPerformance ? (intl("components.submitPerformanceFeedback")) : row?.title ?? (intl("components.reportScheduleIssue2"))}</DialogTitle>
          <DialogDescription>{isPerformance ? (intl("components.shareFeedbackAboutThisSolve")) : (intl("components.reportAScheduleIssue"))}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {isPerformance
              ? (intl("components.thisSubmitsYourNotePlusAPrivateReproductionSnapshot"))
              : (intl("components.thisSubmitsTheRoomIssueAndAPrivateReproduction"))}
          </p>
          <Textarea
            autoFocus
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder={isPerformance ? (intl("components.exampleThisSameBoxUsuallyCompletedFasterBefore")) : (intl("components.exampleThisTeamShouldUseClosureTheCurrentPlacement"))}
            className="min-h-36 text-[13px]"
            maxLength={1000}
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[13px]">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              className="size-4"
            />
            <span>{intl("Common.consentFeedback", { kind: isPerformance ? "performance" : "issue" })}</span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button className="max-sm:min-w-16 sm:min-w-[88px]" size="dialog" variant="ghost" onClick={onCancel}>
            {intl("components.cancel")}
          </Button>
          <Button size="dialog" onClick={onSave} disabled={!note.trim() || note.trim().length > 1000 || !consented || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? (intl("components.submitting")) : (intl("components.submitFeedback"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function ProductChangeConfirmModal({
  open,
  roomLabel,
  changeKind,
  nextValueLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  roomLabel: string;
  changeKind: "制造配方" | "贸易策略";
  nextValueLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <DialogContent
        role="alertdialog"
        aria-busy={busy}
        showCloseButton={!busy}
        className="max-w-[min(520px,calc(100vw-2rem))] sm:max-w-lg"
        data-product-change-confirm
      >
        <DialogHeader>
          <DialogTitle>{intl("components.changeSettingsAndRegenerate")}</DialogTitle>
          <DialogDescription>
            {intl("components.sWillChangeToTheCurrentResultWillBe", { roomLabel: roomLabel, value2: (en) ? (changeKind === "制造配方" ? "factory recipe" : "trade strategy") : "", nextValueLabel: nextValueLabel, changeKind: (en) ? "" : (changeKind) })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="py-2">
          <p className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            {intl("components.settingsRemainLockedUntilRegenerationCompletes")}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button className="max-sm:min-w-16 sm:min-w-[88px]" type="button" size="dialog" variant="ghost" disabled={busy} autoFocus onClick={onCancel}>
            {intl("components.cancel")}
          </Button>
          <Button type="button" size="dialog" variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {busy ? (intl("components.regenerating")) : (intl("components.confirmAndRegenerate"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
