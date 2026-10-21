"use client";

import { useTranslations } from "use-intl";
import { ArrowRight, FlaskConical, PencilLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PlanActionsDialog({ hasBox, showProgression, showManual, visibleVariantLabel, onOpenChange, onProgression, onManual }: {
  hasBox: boolean;
  showProgression: boolean;
  showManual: boolean;
  visibleVariantLabel: string;
  onOpenChange: (open: boolean) => void;
  onProgression: () => void;
  onManual: () => void;
}) {
  const intl = useTranslations();
  return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="gap-5 max-sm:bottom-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-[24px] max-sm:rounded-b-none sm:max-w-lg sm:p-6" data-plan-actions-dialog>
          <DialogHeader className="gap-1.5 px-1 sm:px-2">
            <DialogTitle className="text-lg font-semibold">{intl("components_pages_InfraCalculator.adjustThisPlan")}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {intl("components_pages_InfraCalculator.youAreViewingTheChooseWhetherToChangeThe", { visibleVariantLabel: visibleVariantLabel })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 px-1 sm:px-2">
            {hasBox && showProgression ? (
              <button
                type="button"
                className="group flex min-h-20 w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-background px-4 py-3 text-left outline-none transition-colors hover:border-foreground/40 hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-[#FFD800]"
                onClick={onProgression}
                data-plan-action="progression"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[#313131] text-[#FFD800]" aria-hidden="true"><FlaskConical className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-semibold">{intl("components_pages_InfraCalculator.modifyProgressionAndRecalculate")}</strong>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{intl("components_pages_InfraCalculator.updateTheCurrentBoxKeepTheOriginalPlanAnd")}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            ) : null}
            {showManual ? <button
              type="button"
              className="group flex min-h-20 w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-background px-4 py-3 text-left outline-none transition-colors hover:border-foreground/40 hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-[#FFD800]"
              onClick={onManual}
              data-plan-action="manual"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-muted text-foreground" aria-hidden="true"><PencilLine className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-semibold">{intl("components_pages_InfraCalculator.editTheCurrentPlanManually")}</strong>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{intl("components_pages_InfraCalculator.copyThePlanYouAreViewingAndContinueIn")}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button> : null}
          </div>
        </DialogContent>
      </Dialog>
  );
}
