"use client";
import { useTranslations } from "use-intl";

import { ArrowRight, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { ManualScheduleDraft } from "@/manual-schedule";

export function ManualDraftReplaceDialog({
  draft,
  onCancel,
  onConfirm,
}: {
  draft: ManualScheduleDraft | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const intl = useTranslations();

  const sourceLabel = draft?.source?.variant === "progression-adjusted"
    ? (intl("components_ManualDraftReplaceDialog.progressionAdjustedPlan"))
    : (intl("components_ManualDraftReplaceDialog.originalPlan"));

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="gap-5 max-sm:px-4 sm:max-w-md sm:p-6" data-manual-draft-replace-dialog>
        <DialogHeader className="gap-2 px-1 sm:px-2">
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-800" aria-hidden="true">
            <TriangleAlert className="size-5" />
          </div>
          <DialogTitle className="text-lg font-semibold">
            {intl("components_ManualDraftReplaceDialog.replaceTheExistingManualDraft")}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {intl("components_ManualDraftReplaceDialog.creatingAManualScheduleFromTheWillReplaceYour", { sourceLabel: sourceLabel })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {intl("components_ManualDraftReplaceDialog.keepExistingDraft")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {intl("components_ManualDraftReplaceDialog.replaceAndContinue")}<ArrowRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
