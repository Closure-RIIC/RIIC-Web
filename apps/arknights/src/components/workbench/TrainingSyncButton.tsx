import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import type { useSklandTrainingSync } from "@/hooks/use-skland-training-sync";
import { cn } from "@/lib/utils";

export type TrainingSyncControl = Pick<ReturnType<typeof useSklandTrainingSync>,
  "busy" | "disabled" | "retryIn" | "resume" | "resumeDisabled" | "refresh">;

export function TrainingSyncButton({ sync, className }: { sync: TrainingSyncControl; className?: string }) {
  const t = useTranslations("components_pages_TrainingAdvice");
  return <Button type="button" variant="outline" size="sm" className={cn("shrink-0", className)}
    data-training-sync-action
    disabled={sync.resume ? sync.resumeDisabled : sync.busy || sync.disabled || sync.retryIn > 0}
    onClick={sync.resume ?? sync.refresh}>
    {sync.resume ? t("resumeSync") : sync.retryIn > 0 ? t("syncCooldown", { seconds: sync.retryIn }) : t("syncNow")}
  </Button>;
}
