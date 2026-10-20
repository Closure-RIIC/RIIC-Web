"use client";

import { ImageDown, Loader2 } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";

export function ScheduleImageExportAction({ disabled, exporting, scope, onExport }: {
  disabled: boolean;
  exporting: boolean;
  scope: "single" | "all";
  onExport: () => Promise<void>;
}) {
  const intl = useTranslations("components_pages_InfraCalculator");
  return (
    <div className="flex min-w-0 items-center">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || exporting || scope === "all"}
        aria-busy={exporting}
        title={scope === "all" ? intl("imageExportAllMaintenance") : undefined}
        onClick={() => void onExport()}
      >
        {exporting ? <Loader2 className="animate-spin" /> : <ImageDown />}
        {intl(scope === "all" ? "imageExportAllMaintenance" : exporting ? "exportingImage" : "exportImage")}
      </Button>
    </div>
  );
}
