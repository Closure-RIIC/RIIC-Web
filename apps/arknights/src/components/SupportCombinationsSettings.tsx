"use client";
import { useId } from "react";
import { useTranslations } from "use-intl";

import { Check } from "lucide-react";

/**
 * 受控组合主动补挂件开关。
 *
 * 对应求解器 `plan.compute` 的 `options.support_combinations_enable`：
 * 关闭时不会为了凑受控组合额外补 1–2 名挂件，主角色仍正常竞争。
 */
export function SupportCombinationsSettings({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const intl = useTranslations();
  const id = useId();

  return (
    <section className="grid gap-3" aria-labelledby={`${id}-title`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            {intl("components_SupportCombinationsSettings.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {intl("components_SupportCombinationsSettings.description")}
          </p>
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={enabled}
          className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium"
          onClick={() => onEnabledChange(!enabled)}
        >
          <span className={`grid size-5 place-items-center border transition-colors ${enabled ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
            {enabled ? <Check className="size-3.5" aria-hidden="true" /> : null}
          </span>
          {enabled
            ? intl("components_SupportCombinationsSettings.enabled")
            : intl("components_SupportCombinationsSettings.disabled")}
        </button>
      </div>
    </section>
  );
}
