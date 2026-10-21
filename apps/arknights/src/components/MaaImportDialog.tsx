"use client";

import { useTranslations } from "use-intl";
import type { RefObject } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function MaaImportDialog({ maaImportPreview, confirmMaaImport, onCancel, finalFocus }: {
  maaImportPreview: { format?: "maa" | "mower"; fileName: string; sourceShiftCount: number; importedShiftCount: number; sourceAssignmentCount: number; importedAssignmentCount: number };
  confirmMaaImport: () => void;
  onCancel: () => void;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  const intl = useTranslations();
  return (
      <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
        <DialogContent className="max-w-[min(520px,calc(100vw-2rem))]" finalFocus={finalFocus}>
          <DialogHeader>
            <DialogTitle>{intl(maaImportPreview.format === "mower" ? "components_pages_ManualSchedulePage.importMowerScheduleQuestion" : "components_pages_ManualSchedulePage.importMaaScheduleQuestion")}</DialogTitle>
            <DialogDescription>
              {intl("components_pages_ManualSchedulePage.importMaaScheduleDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 px-5 py-2 text-sm sm:px-7">
            <p className="truncate"><span className="text-muted-foreground">{intl("components_pages_ManualSchedulePage.fileLabel")}</span>{maaImportPreview?.fileName}</p>
            <p>
              <span className="text-muted-foreground">{intl("components_pages_ManualSchedulePage.shiftsLabel")}</span>
              <span className="font-number">{maaImportPreview?.importedShiftCount}</span>
              {maaImportPreview && maaImportPreview.sourceShiftCount !== maaImportPreview.importedShiftCount ? (
                <span className="ml-2 text-muted-foreground">
                  {intl("components_pages_ManualSchedulePage.expandedFromPlans", { count: maaImportPreview.sourceShiftCount })}
                </span>
              ) : null}
            </p>
            <p>
              <span className="text-muted-foreground">{intl("components_pages_ManualSchedulePage.assignmentsLabel")}</span>
              <span className="font-number">{maaImportPreview?.importedAssignmentCount}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="font-number">{maaImportPreview?.sourceAssignmentCount}</span>
              {maaImportPreview && maaImportPreview.sourceAssignmentCount > maaImportPreview.importedAssignmentCount ? (
                <span className="ml-2 text-amber-700">
                  {intl("components_pages_ManualSchedulePage.unmappedAssignments", { count: maaImportPreview.sourceAssignmentCount - maaImportPreview.importedAssignmentCount })}
                </span>
              ) : null}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {intl(maaImportPreview.format === "mower" ? "components_pages_ManualSchedulePage.importMowerScheduleDetails" : "components_pages_ManualSchedulePage.importMaaScheduleDetails")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>{intl("components_pages_ManualSchedulePage.cancel")}</Button>
            <Button type="button" onClick={confirmMaaImport}><Upload />{intl("components_pages_ManualSchedulePage.replaceDraft")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
