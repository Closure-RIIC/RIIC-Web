"use client";

import { useState } from "react";
import { useLocale } from "use-intl";
import { Decimal } from "decimal.js";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type AdminMessages from "../../../../messages/zh-CN/Admin_policy_editor.json";
import { AGENT_MODELS, type AgentModelChoice, type AgentModelId } from "@/agent-models";
import type { AgentModelSettingsChange, AgentModelSettingsPayload, AgentModelSettingsVersion, ModelSettingsData } from "@/agent-model-settings";
import type { AgentModelEntry } from "@/server/agent/model-policy";
import type { ModelRate } from "@/server/billing/rate-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAdminRequest } from "../admin-context";

const adminText = createLocalizer<typeof AdminMessages>("Admin_policy_editor");
const BYTES_PER_MIB = 1024 * 1024;
const PIXELS_PER_MEGAPIXEL = 1_000_000;
const RATE_FIELDS = ["input", "cachedInput", "output"] as const;
const CACHE_WRITE_RATE_FIELDS = ["input", "cachedInput", "cacheWrite", "output"] as const;
type RatePrices = Pick<ModelRate, "input" | "cachedInput" | "cacheWrite" | "output">;
const rateFields = (prices: RatePrices) => prices.cacheWrite === undefined ? RATE_FIELDS : CACHE_WRITE_RATE_FIELDS;
const FIELD_CLASS = "grid min-w-0 content-start gap-2 leading-snug";
const SELECT_CLASS = "h-9 min-w-0 rounded-md border bg-background px-2 text-sm";

function localizedRateLabels(locale: ReturnType<typeof useLocale>) {
  return { input: adminText.text(locale, "input"), cachedInput: adminText.text(locale, "cachedInput"),
    cacheWrite: adminText.text(locale, "cacheWrite"), output: adminText.text(locale, "output") };
}

function initialLongContextPrices(rate: RatePrices) {
  const scale = (value: string, multiplier: string, allowZero = false) => {
    if (!/^\d{1,7}(\.\d{1,8})?$/.test(value) || (!allowZero && new Decimal(value).isZero())) return "";
    const result = new Decimal(value).mul(multiplier).toDecimalPlaces(8, Decimal.ROUND_CEIL).toFixed();
    return /^\d{1,7}(\.\d{1,8})?$/.test(result) ? result : "";
  };
  return { input: scale(rate.input, "2"), cachedInput: scale(rate.cachedInput, "2", true), output: scale(rate.output, "1.5"), ...(rate.cacheWrite !== undefined ? { cacheWrite: "" } : {}) };
}

function toggleCacheWrite<T extends RatePrices>(prices: T, enabled: boolean): T {
  const next = { ...prices };
  if (enabled) next.cacheWrite = "";
  else delete next.cacheWrite;
  return next;
}

export function ModelSettingsEditor({ settings, refresh, modelChoices = [], rateModels = [], modelDirectory = [] }: {
  settings: ModelSettingsData;
  refresh: () => Promise<void>;
  modelChoices?: AgentModelChoice[];
  rateModels?: { id: string; provider: string; model: string }[];
  modelDirectory?: { provider: string; routeConfigured: boolean | null }[];
}) {
  const locale = useLocale();
  const officialRoute = modelDirectory.find(row => row.provider === "riic-deepseek-official");
  const request = useAdminRequest();
  const [payload, setPayload] = useState<AgentModelSettingsPayload>(() => structuredClone(settings.active?.payload ?? settings.initialPayload));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "publish" | "rollback"; version: AgentModelSettingsVersion } | null>(null);

  function updateModel(id: AgentModelId, fields: Partial<AgentModelEntry>) {
    setPayload(current => ({ ...current, models: { ...current.models, models: current.models.models.map(row => row.id === id ? { ...row, ...fields } : row) } }));
  }
  function updateRate(provider: string, fields: Partial<ModelRate>) {
    setPayload(current => ({ ...current, rates: { ...current.rates, models: current.rates.models.map(row => row.provider === provider ? { ...row, ...fields } : row) } }));
  }
  function addRate(route: { provider: string; model: string } | undefined) {
    if (!route) return;
    setPayload(current => ({ ...current, rates: { ...current.rates, models: [...current.rates.models,
      { provider: route.provider, model: route.model, currency: "RMB", exchangeRate: "1", input: "", cachedInput: "", output: "" }] } }));
  }
  async function save(action: AgentModelSettingsChange["action"], id?: string) {
    setBusy(true); setError(""); setNotice("");
    const change: AgentModelSettingsChange = {
      action, reason, expectedActive: settings.expectedActive,
      ...(action === "draft" ? { payload } : { id }),
    };
    try {
      await request("/api/admin/billing?section=model-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      setConfirm(null);
      await refresh();
      if (action === "draft") setNotice(adminText.text(locale, "modelSettingsDraftSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return <section className="space-y-5" data-model-settings-editor>
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">{adminText.text(locale, "modelSettings")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{adminText.text(locale, "modelSettingsHint")}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "providerPricesPerMillionTokensPublishedRatesApply")}</p>
      </div>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Label className={FIELD_CLASS}>{adminText.text(locale, "defaultModel")}<select className={SELECT_CLASS} value={payload.models.defaultModel} onChange={event => setPayload(current => ({ ...current, models: { ...current.models, defaultModel: event.target.value as AgentModelId } }))}>{payload.models.models.filter(model => model.enabled).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></Label>
        <Label className={FIELD_CLASS}>{adminText.text(locale, "serviceMultiplier")}<Input value={payload.rates.markup} placeholder={adminText.text(locale, "enterServiceMultiplier")} inputMode="decimal" onChange={event => setPayload(current => ({ ...current, rates: { ...current.rates, markup: event.target.value } }))} /></Label>
      </fieldset>
      <p className="text-xs text-muted-foreground">{adminText.text(locale, "serviceMultiplierRequired")}</p>
      {!settings.active && <p role="status" className="text-sm text-muted-foreground">{adminText.text(locale, "notPublished")}</p>}
    </div>

    {payload.models.models.map(model => {
      const identity = AGENT_MODELS[model.id];
      const rate = payload.rates.models.find(row => row.provider === identity.provider);
      const route = rateModels.find(row => row.provider === identity.provider);
      const choice = modelChoices.find(row => row.id === model.id);
      const isDefault = payload.models.defaultModel === model.id;
      const status = adminText.text(locale, choice?.available ? "modelReady" : choice?.reason === "route_unconfigured" ? "routeMissing" : choice?.reason === "rate_missing" ? "rateMissing" : choice?.reason === "image_budget_missing" ? "imageBudgetMissing" : "modelNotReady");
      return <fieldset key={model.id} disabled={busy} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5" data-model-settings-card={model.id}>
        <legend className="px-2 font-semibold">{identity.label}</legend>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, identity.vision ? "visionModel" : "textModel")} · {adminText.text(locale, "activeModelStatus", { status })}</p>
          <Label className="shrink-0" title={isDefault ? adminText.text(locale, "changeDefaultBeforeDisabling") : undefined}><input type="checkbox" checked={model.enabled} disabled={isDefault} onChange={event => updateModel(model.id, { enabled: event.target.checked })} />{adminText.text(locale, "modelEnabled")}{isDefault ? <span className="text-xs text-muted-foreground">· {adminText.text(locale, "defaultModelBadge")}</span> : null}</Label>
        </div>
        <p className="text-xs text-muted-foreground">{adminText.text(locale, "modelSelectionScope")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label className={FIELD_CLASS}>{adminText.text(locale, "modelLabel")}<Input value={model.label} maxLength={60} onChange={event => updateModel(model.id, { label: event.target.value })} /></Label>
        </div>

        <RouteRateEditor rate={rate} route={route} gpt={model.id === "gpt"} locale={locale}
          onChange={fields => updateRate(identity.provider, fields)} onAdd={() => addRate(route)} />

        {identity.vision ? <details className="border-t pt-3" data-model-image-settings>
          <summary className="cursor-pointer text-sm font-medium">{adminText.text(locale, "imageAdvancedSettings")}</summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className={FIELD_CLASS}>{adminText.text(locale, "maxImages")}<Input type="number" min="0" value={model.maxImages} onChange={event => updateModel(model.id, { maxImages: Number(event.target.value) })} /></Label>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "imageBudgetPerImageHint")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className={FIELD_CLASS}>{adminText.text(locale, "maxImageBytes")}<Input type="number" inputMode="decimal" min={1024 / BYTES_PER_MIB} step="any" value={model.maxImageBytes / BYTES_PER_MIB} aria-describedby={`${model.id}-image-bytes-help`} onChange={event => updateModel(model.id, { maxImageBytes: Math.round(Number(event.target.value) * BYTES_PER_MIB) })} /></Label>
                <p id={`${model.id}-image-bytes-help`} className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "maxImageBytesHint")}</p>
              </div>
              <div className="space-y-2">
                <Label className={FIELD_CLASS}>{adminText.text(locale, "maxImagePixels")}<Input type="number" inputMode="decimal" min={1024 / PIXELS_PER_MEGAPIXEL} step="any" value={model.maxImagePixels / PIXELS_PER_MEGAPIXEL} aria-describedby={`${model.id}-image-pixels-help`} onChange={event => updateModel(model.id, { maxImagePixels: Math.round(Number(event.target.value) * PIXELS_PER_MEGAPIXEL) })} /></Label>
                <p id={`${model.id}-image-pixels-help`} className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "maxImagePixelsHint")}</p>
              </div>
              <Label className={FIELD_CLASS}>{adminText.text(locale, "imageTokensPerImage")}<Input type="number" min="0" value={model.imageTokensPerImage} onChange={event => updateModel(model.id, { imageTokensPerImage: Number(event.target.value) })} /></Label>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "imageBudgetHint")}</p>
          </div>
        </details> : null}
      </fieldset>;
    })}

    <fieldset disabled={busy} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5" data-model-settings-card="deepseek-official">
      <legend className="px-2 font-semibold">{adminText.text(locale, "officialDeepseekRate")}</legend>
      <p className="text-xs text-muted-foreground">{adminText.text(locale, "officialDeepseekHint")}</p>
      <p className="text-xs text-muted-foreground">{adminText.text(locale, officialRoute?.routeConfigured === true ? "routeConfigured" : officialRoute?.routeConfigured === false ? "routeMissing" : "routeStateUnconfirmed")}</p>
      <RouteRateEditor rate={payload.rates.models.find(row => row.provider === "riic-deepseek-official")}
        route={rateModels.find(row => row.provider === "riic-deepseek-official")} locale={locale}
        onChange={fields => updateRate("riic-deepseek-official", fields)} onAdd={() => addRate(rateModels.find(row => row.provider === "riic-deepseek-official"))} />
    </fieldset>

    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <Label className={FIELD_CLASS}>{adminText.text(locale, "changeReason")}<Input value={reason} disabled={busy} maxLength={500} onChange={event => setReason(event.target.value)} /></Label>
      {error && !confirm ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      <Button type="button" disabled={busy || !reason.trim()} onClick={() => void save("draft")}>{adminText.text(locale, "saveDraft")}</Button>
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">{adminText.text(locale, "modelSettingsHistory")}</h3>
        <p className="text-xs text-muted-foreground">{adminText.text(locale, "modelSettingsHistoryHint")}</p>
        {settings.versions.slice(0, 12).map(version => <div key={version.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mr-auto">{adminText.text(locale, "modelSettingsVersion", { version: version.version })} · {adminText.text(locale, version.status === "active" ? "versionActive" : version.status === "draft" ? "versionDraft" : "versionRetired")} · {new Date(version.created_at).toLocaleString(locale)}</span>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setPayload(structuredClone(version.payload)); setError(""); setNotice(adminText.text(locale, "modelSettingsLoaded", { version: version.version })); }}>{adminText.text(locale, "load")}</Button>
          {version.status !== "active" ? <Button type="button" size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => { setError(""); setConfirm({ action: version.status === "draft" ? "publish" : "rollback", version }); }}>{adminText.text(locale, version.status === "draft" ? "publish" : "restoreThisVersion")}</Button> : null}
        </div>)}
      </div>
    </div>

    <Dialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{adminText.text(locale, confirm?.action === "rollback" ? "restoreModelSettings" : "publishModelSettings")}</DialogTitle>
          <DialogDescription>{adminText.text(locale, "modelSettingsConfirmHint")}</DialogDescription>
        </DialogHeader>
        {confirm ? <ModelSettingsSnapshot payload={confirm.version.payload} version={confirm.version.version} locale={locale} /> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" disabled={busy || !reason.trim()} onClick={() => confirm && void save(confirm.action, confirm.version.id)}>{adminText.text(locale, confirm?.action === "rollback" ? "confirmRestoreModelSettings" : "confirmPublish")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

function ModelSettingsSnapshot({ payload, version, locale }: { payload: AgentModelSettingsPayload; version: number; locale: ReturnType<typeof useLocale> }) {
  const defaultModel = payload.models.models.find(model => model.id === payload.models.defaultModel);
  const fieldLabels = localizedRateLabels(locale);
  return <div className="space-y-4 text-sm" data-model-settings-snapshot>
    <p className="font-medium">{adminText.text(locale, "modelSettingsVersion", { version })}</p>
    <dl className="grid gap-2 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{adminText.text(locale, "defaultModel")}</dt><dd>{defaultModel?.label}</dd></div>
      <div><dt className="text-muted-foreground">{adminText.text(locale, "serviceMultiplier")}</dt><dd>{payload.rates.markup}</dd></div>
    </dl>
    {payload.models.models.map(model => {
      const rate = payload.rates.models.find(row => row.provider === AGENT_MODELS[model.id].provider);
      return <div key={model.id} className="space-y-2 rounded-lg border p-3">
        <p className="font-medium">{AGENT_MODELS[model.id].label} · {adminText.text(locale, model.enabled ? "modelEnabled" : "modelDisabled")}</p>
        <p>{adminText.text(locale, "modelLabel")}: {model.label}</p>
        {rate ? <>
          <p className="break-all">{adminText.text(locale, "actualModel")}: {rate.model}</p>
          <p>{adminText.text(locale, "currency")}: {rate.currency} · {adminText.text(locale, "rmbExchangeRate")}: {rate.exchangeRate}</p>
          {model.id === "gpt" ? <p className="font-medium">{adminText.text(locale, "gptStandardTier")}</p> : null}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rateFields(rate).map(field => <div key={field}><dt className="text-muted-foreground">{fieldLabels[field]}</dt><dd>{rate[field]}</dd></div>)}</dl>
          {rate.cacheWrite === undefined ? <p className="text-xs text-muted-foreground">{adminText.text(locale, "cacheWriteDisabled")}</p> : null}
          {rate.peak ? <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rateFields(rate.peak).map(field => <div key={field}><dt className="text-muted-foreground">{adminText.text(locale, "peak")}{fieldLabels[field]}</dt><dd>{rate.peak![field]}</dd></div>)}</dl> : null}
          {rate.offPeakDates?.length ? <p className="break-words">{adminText.text(locale, "offPeakDates")}: {rate.offPeakDates.join(", ")}</p> : null}
          {model.id === "gpt" ? rate.longContext ? <div className="space-y-2 border-t pt-2">
            <p className="font-medium">{adminText.text(locale, "gptLongContextTier")}</p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rateFields(rate.longContext).map(field => <div key={field}><dt className="text-muted-foreground">{fieldLabels[field]}</dt><dd>{rate.longContext![field]}</dd></div>)}</dl>
            {rate.longContext.peak ? <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rateFields(rate.longContext.peak).map(field => <div key={field}><dt className="text-muted-foreground">{adminText.text(locale, "peak")}{fieldLabels[field]}</dt><dd>{rate.longContext!.peak![field]}</dd></div>)}</dl> : null}
            <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "gptLongContextHint")}</p>
          </div> : <p className="text-xs text-muted-foreground">{adminText.text(locale, "gptLongContextDisabled")}</p> : null}
        </> : <p>{adminText.text(locale, "modelRateNotConfigured")}</p>}
        {AGENT_MODELS[model.id].vision ? <dl className="grid gap-2 border-t pt-2 sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{adminText.text(locale, "maxImages")}</dt><dd>{model.maxImages}</dd></div>
          <div><dt className="text-muted-foreground">{adminText.text(locale, "maxImageBytes")}</dt><dd>{model.maxImageBytes / BYTES_PER_MIB}</dd></div>
          <div><dt className="text-muted-foreground">{adminText.text(locale, "maxImagePixels")}</dt><dd>{model.maxImagePixels / PIXELS_PER_MEGAPIXEL}</dd></div>
          <div><dt className="text-muted-foreground">{adminText.text(locale, "imageTokensPerImage")}</dt><dd>{model.imageTokensPerImage}</dd></div>
        </dl> : null}
      </div>;
    })}
    {payload.rates.models.filter(rate => rate.provider === "riic-deepseek-official").map(rate => <div key={rate.provider} className="space-y-2 rounded-lg border p-3" data-official-rate-snapshot>
      <p className="font-medium">{adminText.text(locale, "officialDeepseekRate")}</p>
      <p>{adminText.text(locale, "actualModel")}: {rate.model}</p>
      <p>{adminText.text(locale, "currency")}: {rate.currency} · {adminText.text(locale, "rmbExchangeRate")}: {rate.exchangeRate}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rateFields(rate).map(field => <div key={field}><dt>{fieldLabels[field]}</dt><dd>{rate[field]}</dd></div>)}</dl>
      {rate.cacheWrite === undefined ? <p className="text-xs text-muted-foreground">{adminText.text(locale, "cacheWriteDisabled")}</p> : null}
      {rate.peak && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rateFields(rate.peak).map(field => <div key={field}><dt>{adminText.text(locale, "peak")}{fieldLabels[field]}</dt><dd>{rate.peak![field]}</dd></div>)}</dl>}
      {rate.offPeakDates?.length ? <p className="break-words">{adminText.text(locale, "offPeakDates")}: {rate.offPeakDates.join(", ")}</p> : null}
    </div>)}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">{adminText.text(locale, "fullModelSettingsSnapshot")}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{JSON.stringify(payload, null, 2)}</pre></details>
  </div>;
}

function RouteRateEditor({ rate, route, gpt = false, locale, onChange, onAdd }: {
  rate?: ModelRate; route?: { provider: string; model: string }; gpt?: boolean;
  locale: ReturnType<typeof useLocale>; onChange: (fields: Partial<ModelRate>) => void; onAdd: () => void;
}) {
  const [calendarDraft, setCalendarDraft] = useState<string | null>(null);
  const cacheWriteEnabled = rate?.cacheWrite !== undefined;
  const fieldLabels = localizedRateLabels(locale);
  return <>
    <Label className={FIELD_CLASS}>{adminText.text(locale, "actualModel")}<Input value={rate?.model ?? route?.model ?? ""} readOnly /></Label>
    <p className="text-xs text-muted-foreground">{adminText.text(locale, "routeIdentityManaged")}</p>
    {rate && route && rate.model !== route.model ? <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">{adminText.text(locale, "routeModelChanged", { model: route.model })}</p>
      <Button type="button" variant="outline" onClick={() => onChange({ model: route.model })}>{adminText.text(locale, "useCurrentRouteModel")}</Button>
    </div> : null}
        {rate ? <>
          <div className="space-y-2">
            <Label><input type="checkbox" checked={cacheWriteEnabled} onChange={event => {
              const enabled = event.target.checked;
              onChange({ cacheWrite: enabled ? "" : undefined,
                ...(rate.peak ? { peak: toggleCacheWrite(rate.peak, enabled) } : {}),
                ...(rate.longContext ? { longContext: { ...toggleCacheWrite(rate.longContext, enabled),
                  ...(rate.longContext.peak ? { peak: toggleCacheWrite(rate.longContext.peak, enabled) } : {}) } } : {}),
              });
            }} />{adminText.text(locale, "cacheWriteEnabled")}</Label>
            {cacheWriteEnabled ? <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "cacheWriteHint")}</p> : null}
          </div>
          {gpt ? <h3 className="text-sm font-medium">{adminText.text(locale, "gptStandardTier")}</h3> : null}
          <div className={cacheWriteEnabled ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-5"}>
            {rateFields(rate).map(field => <Label key={field} className={FIELD_CLASS}>{fieldLabels[field]}<Input inputMode="decimal" value={rate[field] ?? ""} onChange={event => onChange({ [field]: event.target.value })} /></Label>)}
            <Label className={FIELD_CLASS}>{adminText.text(locale, "currency")}<select className={SELECT_CLASS} value={rate.currency} onChange={event => onChange({ currency: event.target.value as ModelRate["currency"] })}><option value="RMB">RMB</option><option value="USD">USD</option></select></Label>
            <Label className={FIELD_CLASS}>{adminText.text(locale, "rmbExchangeRate")}<Input inputMode="decimal" value={rate.exchangeRate} onChange={event => onChange({ exchangeRate: event.target.value })} /></Label>
          </div>
          <div className="space-y-3">
            <Label><input type="checkbox" checked={Boolean(rate.peak)} onChange={event => {
              const peak = event.target.checked ? { input: "", cachedInput: "", output: "", ...(cacheWriteEnabled ? { cacheWrite: "" } : {}) } : undefined;
              onChange({ peak, longContext: rate.longContext ? { ...rate.longContext, peak: peak ? { ...peak } : undefined } : undefined });
            }} />{adminText.text(locale, "peakRatesEnabled")}</Label>
            {rate.peak ? <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{rateFields(rate).map(field => <Label key={field} className={FIELD_CLASS}>{adminText.text(locale, "peak")}{fieldLabels[field]}<Input inputMode="decimal" value={rate.peak![field] ?? ""} onChange={event => onChange({ peak: { ...rate.peak!, [field]: event.target.value } })} /></Label>)}</div>
              <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "peakRatesHint")}</p>
            </> : null}
          </div>
          {gpt ? <section className="space-y-3 rounded-lg bg-muted/40 p-3" data-model-long-context-rates>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{adminText.text(locale, "gptLongContextTier")}</h3>
              {rate.longContext ? <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ longContext: undefined })}>{adminText.text(locale, "removeLongContextTier")}</Button> : <Button type="button" size="sm" variant="outline" onClick={() => onChange({ longContext: { inputTokenThreshold: 272000, ...initialLongContextPrices(rate), ...(rate.peak ? { peak: initialLongContextPrices(rate.peak) } : {}) } })}>{adminText.text(locale, "addLongContextTier")}</Button>}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "gptLongContextHint")}</p>
            {rate.longContext ? <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{rateFields(rate).map(field => <Label key={field} className={FIELD_CLASS}>{fieldLabels[field]}<Input inputMode="decimal" value={rate.longContext![field] ?? ""} onChange={event => onChange({ longContext: { ...rate.longContext!, [field]: event.target.value } })} /></Label>)}</div>
              {rate.peak ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{rateFields(rate).map(field => <Label key={field} className={FIELD_CLASS}>{adminText.text(locale, "peak")}{fieldLabels[field]}<Input inputMode="decimal" value={rate.longContext!.peak?.[field] ?? ""} onChange={event => onChange({ longContext: { ...rate.longContext!, peak: { input: "", cachedInput: "", output: "", ...(cacheWriteEnabled ? { cacheWrite: "" } : {}), ...rate.longContext!.peak, [field]: event.target.value } } })} /></Label>)}</div> : null}
            </> : <p className="text-xs leading-relaxed text-muted-foreground">{adminText.text(locale, "gptLongContextDisabled")} {adminText.text(locale, "gptLongContextInitializeHint")}</p>}
          </section> : null}
          <Label className={FIELD_CLASS}>{adminText.text(locale, "offPeakDates")}<Textarea data-off-peak-dates value={calendarDraft ?? (rate.offPeakDates ?? []).join("\n")} onBlur={() => setCalendarDraft(null)} onChange={event => { setCalendarDraft(event.target.value); onChange({ offPeakDates: event.target.value.split(/\r?\n/).map(day => day.trim()).filter(Boolean) }); }} /></Label>
          <p className="text-xs text-muted-foreground">{adminText.text(locale, "offPeakDatesHint")}</p>
        </> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">{adminText.text(locale, "modelRateNotConfigured")}</p>
          <Button type="button" size="sm" variant="outline" disabled={!route} onClick={onAdd}>{adminText.text(locale, "addModelRate")}</Button>
        </div>}

  </>;
}
