"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../../messages/zh-CN/AK_app_admin_quality_workbench_ui.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_app_admin_quality_workbench_ui");
import type { AppLocale } from "@riic/contracts/locale";
import { useId, type ReactNode } from "react";
import { useLocale } from "use-intl";
import { CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { QualityVersion } from "@riic/arknights-domain/quality";

export function useWorkbenchText() {
  const en = useLocale();
  return { en };
}

export function Panel({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  const headingId = useId();
  return <section id={id} aria-labelledby={headingId} className="min-w-0 scroll-mt-6">
    <Card className="min-w-0">
      <CardHeader><h2 id={headingId} className="text-base font-semibold">{title}</h2>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent className="grid min-w-0 gap-4">{children}</CardContent>
    </Card>
  </section>;
}

export function Choice({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId();
  const selected = options.find(option => option.value === value) ?? null;
  return <div className="grid min-w-0 gap-2">
    <Label htmlFor={id}>{label}</Label>
    <Combobox items={options} value={selected} itemToStringValue={option => option.label} isItemEqualToValue={(a, b) => a.value === b.value} onValueChange={option => { if (option) onChange(option.value); }} disabled={disabled}>
      <ComboboxInput id={id} readOnly className="h-11 w-full min-w-0 bg-background" />
      <ComboboxContent><ComboboxList>{option => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
  </div>;
}

export function Check({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50">
    <input type="checkbox" className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} />
    <span>{label}</span>
  </label>;
}

export function statusText(status: string, en: AppLocale) {
  const keys: Record<string, keyof typeof UiMessages> = {"queued":"status_queued","running":"status_running","completed":"status_completed","failed":"status_failed","cancelled":"status_cancelled","interrupted":"status_interrupted"};
  return keys[status] ? uiText.text(en, keys[status]) : status;
}

export function Status({ status }: { status: string }) {
  const { en } = useWorkbenchText();
  const Icon = status === "completed" ? CheckCircle2 : status === "running" ? Loader2 : status === "failed" ? XCircle : Clock3;
  return <Badge variant={status === "failed" ? "destructive" : status === "completed" ? "secondary" : "outline"}><Icon aria-hidden="true" className={status === "running" ? "motion-safe:animate-spin" : undefined} />{statusText(status, en)}</Badge>;
}

export function dateText(value: string, en: AppLocale) {
  return new Intl.DateTimeFormat(en === "en" ? "en-GB" : en, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function versionText(version: QualityVersion, index: number, en: AppLocale) {
  const label = index === 0 ? (uiText.text(en, "latestProduction")) : index === 1 ? (uiText.text(en, "previousProduction")) : (uiText.text(en, "production"));
  return `${label} · ${version.executableSha256.slice(0, 8)}`;
}

export function download(name: string, value: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = href; link.download = name; link.click(); URL.revokeObjectURL(href);
}
