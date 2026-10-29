"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_app_plush_PlushGallery.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_app_plush_PlushGallery");


// @refresh reset
// Recreate the WebGL lifecycle and hook state together during development edits.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BUILTIN_AGENT_PERSONAS } from "@/agent-personas";
import { personaPresentation } from "@/agent-persona-presentation";
import { FurAvatar } from "@/components/agent/ClosureFurAvatar";
import { FurSettingsContext } from "@/components/agent/FurSettingsContext";
import { FUR_CONTROLS, FUR_PRESETS, FUR_STORAGE_KEY, galleryFurSettings, normalizeFurSettings, type FurSettings } from "@/components/agent/fur-settings";
import { notifyFurSettingsChanged } from "@/components/agent/fur-settings-store";
import { normalizeFurPerformanceMode } from "@/components/agent/fur-performance";
import { useFurPerformanceMode } from "@/components/agent/fur-performance-store";
import personaStyles from "@/components/agent/PersonaPreview.module.css";
import billingStyles from "@/components/billing/BillingPrototype.module.css";
import styles from "./plush.module.css";
import { usePlushTransition } from "./usePlushTransition";

// The same public catalog/components as the persona picker, never private prompts.
const companions = [
  { id: "closure", name: "可露希尔", theme: "red", avatar: undefined },
  ...BUILTIN_AGENT_PERSONAS,
];
const companionIds = companions.map(persona => persona.id);
const companionThemes: Record<string, string> = { red: personaStyles.closure, blue: billingStyles.monthly, yellow: personaStyles.sunny };
// The revised strand shader has a new baseline. Preserve v1 storage untouched;
// users can still import their old files, but start this material revision in fine quality.
const STORAGE_KEY = FUR_STORAGE_KEY;
type SettingsByPersona = Record<string, FurSettings>;

function readSettings(input: unknown): SettingsByPersona {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid settings");
  const data = input as Record<string, unknown>;
  if (![1, 2].includes(data.version as number) || !data.personas || typeof data.personas !== "object") throw new Error("invalid version");
  const personas = data.personas as Record<string, unknown>;
  return Object.fromEntries(companions.map(({ id }) => [id, personas[id] ? normalizeFurSettings(personas[id]) : FUR_PRESETS.fine]));
}

export function PlushGallery({ debug = false }: { debug?: boolean }) {
  const rawLocale = useRawLocale();
  const [settings, setSettings] = useState<SettingsByPersona>({});
  const [performanceMode, setPerformanceMode] = useFurPerformanceMode();
  const { selected, select, galleryRef, stageRef } = usePlushTransition(companionIds);
  const [open, setOpen] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [status, setStatus] = useState<"" | "localReadFailed" | "localSaveFailed" | "fileTooLarge" | "invalidFile">("");
  const [metrics, setMetrics] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const values = useMemo(() => galleryFurSettings(settings[selected] ?? FUR_PRESETS.fine), [settings, selected]);
  const selectedIndex = companions.findIndex(persona => persona.id === selected);
  const persona = companions[selectedIndex];
  const companionName = (value: typeof companions[number]) => "kind" in value ? personaPresentation(value, rawLocale).name : rawText.text(rawLocale, "closure");
  const displayName = companionName(persona);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Hydrate browser-only preferences after the server's deterministic first render.
      if (stored) setSettings(readSettings(JSON.parse(stored)));
    } catch { setStatus("localReadFailed"); }
  }, []);

  useEffect(() => {
    if (!debug || !open) return;
    let previousFrames = 0, previousTime = performance.now();
    const update = () => {
      if (document.hidden) return;
      const avatar = galleryRef.current?.querySelector<HTMLElement>(`[data-plush-card="${selected}"] [data-fur-avatar]`);
      if (!avatar) return;
      const { furReady, furDrawMs, furGpuMs, furFrameMs, furPixels, furWidth, furMotion, furFrames, furRenderer } = avatar.dataset;
      const now = performance.now(), frames = Number(furFrames ?? 0);
      const fps = previousFrames ? Math.max(0, frames - previousFrames) * 1000 / (now - previousTime) : 0;
      previousFrames = frames; previousTime = now;
      const gpu = furGpuMs ? ` · GPU ${furGpuMs} ms` : "";
      const interval = furFrameMs ? ` · ${rawText.text(rawLocale, "frameCompleted")} ${furFrameMs} ms` : "";
      setMetrics(furReady !== "true" ? rawText.text(rawLocale, "loading3d") :
        `${furWidth ?? furPixels} × ${furPixels} px · ${fps.toFixed(0)} fps · ${furRenderer === "webgl" ? rawText.text(rawLocale, "cpuSubmit") : rawText.text(rawLocale, "drawWait")} ${furDrawMs} ms${gpu}${interval} · ${furMotion === "animated" ? rawText.text(rawLocale, "animated") : rawText.text(rawLocale, "paused")}`);
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [debug, open, selected, galleryRef, rawLocale]);

  const save = (next: SettingsByPersona) => {
    setSettings(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, personas: next })); notifyFurSettingsChanged(); setStatus(""); }
    catch { setStatus("localSaveFailed"); }
  };
  const change = (next: FurSettings) => save({ ...settings, [selected]: galleryFurSettings(next) });
  const exportSettings = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 2, personas: settings }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "riic-plush-settings.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const controls = (items: readonly typeof FUR_CONTROLS[number][]) => <div className={styles.controls}>
    {items.map(control => <div className={styles.control} key={control.key}>
      <label htmlFor={`fur-${control.key}`}>{rawText.text(rawLocale, `control_${control.key}`)}</label>
      <input id={`fur-${control.key}`} type="range" min={control.min} max={control.max} step={control.step}
        value={values[control.key]} onChange={event => change({ ...values, [control.key]: event.currentTarget.valueAsNumber })} />
      <output htmlFor={`fur-${control.key}`}>{values[control.key].toFixed(control.step === 1 ? 0 : 2)}</output>
    </div>)}
  </div>;

  return <>
    <main ref={galleryRef} className={styles.gallery} data-debug={debug ? "true" : undefined} aria-label={rawText.text(rawLocale, "plushGallery")}>
      <article ref={stageRef} className={styles.stage} data-plush-card={persona.id} aria-label={displayName}
        style={{ "--plush-zoom": values.zoom } as CSSProperties}>
        <div className={styles.shadow} data-plush-backdrop aria-hidden="true" />
        <svg className={`${styles.name} ${companionThemes[persona.theme]}`} data-plush-backdrop data-plush-name={persona.id}
          width={displayName.length * 100} height="110" viewBox={`0 0 ${displayName.length * 100} 110`}
          preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <text x="50%" y="55" textAnchor="middle" dominantBaseline="central" fontSize="100" fontWeight="900"
            textLength={displayName.length * 100} lengthAdjust="spacingAndGlyphs" fill="currentColor">{displayName}</text>
        </svg>
        <div className={styles.plush} role="img" aria-label={rawText.text(rawLocale, "plushFor", { name: displayName })}>
          <FurSettingsContext.Provider value={values}>
            <FurAvatar variant={persona.avatar ?? "closure"} nextVariant={companions[(selectedIndex + 1) % companions.length].avatar ?? "closure"} active={animate} fullWidth />
          </FurSettingsContext.Provider>
        </div>
      </article>
    </main>
    <div ref={pickerRef} className={styles.picker} role="toolbar" aria-label={rawText.text(rawLocale, "switchPlushCharacter")}
      style={{ "--selected": selectedIndex } as CSSProperties}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? companions.length - 1 :
          (selectedIndex + (event.key === "ArrowRight" ? 1 : -1) + companions.length) % companions.length;
        select(companions[next].id);
        pickerRef.current?.querySelectorAll("button")[next]?.focus();
      }}>
      <span className={styles.thumb} aria-hidden="true" />
      {companions.map(item => <button type="button" key={item.id} aria-label={companionName(item)} title={companionName(item)}
        tabIndex={selected === item.id ? 0 : -1} aria-pressed={selected === item.id} onClick={() => select(item.id)}>
        <span className={styles.icon} aria-hidden="true"><FurAvatar variant={item.avatar ?? "closure"} preview /></span>
      </button>)}
    </div>
    <details className={styles.performance} aria-label={rawText.text(rawLocale, "plushPerformanceSettings")} open={!debug}>
      <summary>{rawText.text(rawLocale, "graphicsAndPowerSettings")}</summary>
      <div className={styles.performanceControls}>
        <label htmlFor="fur-performance-mode">{rawText.text(rawLocale, "graphicsAndPower")}</label>
        <select id="fur-performance-mode" value={performanceMode} aria-describedby="fur-performance-description"
          onChange={event => setPerformanceMode(normalizeFurPerformanceMode(event.currentTarget.value))}>
          <option value="auto">{rawText.text(rawLocale, "automatic")}</option>
          <option value="quality">{rawText.text(rawLocale, "highQuality")}</option>
          <option value="balanced">{rawText.text(rawLocale, "balanced")}</option>
          <option value="saver">{rawText.text(rawLocale, "powerSaving")}</option>
          <option value="static">{rawText.text(rawLocale, "static")}</option>
        </select>
        {performanceMode === "auto" && <button type="button" onClick={() => {
          galleryRef.current?.querySelector<HTMLElement>("[data-fur-avatar]")?.dispatchEvent(new Event("fur-retry"));
        }}>{rawText.text(rawLocale, "recheckPerformance")}</button>}
      </div>
      <p id="fur-performance-description">{rawText.rich(rawLocale, "preferencesAreSavedSeparatelyAndDoNotChangeThe", { part1: richValue((rawText.text(rawLocale, `performance_${performanceMode}`))) })}</p>
    </details>
    {debug && <section className={styles.lab} aria-label={rawText.text(rawLocale, "plushDebugPanel")}>
      {controls(FUR_CONTROLS.slice(0, 8))}
      <details className={styles.more} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>{rawText.text(rawLocale, "moreSettings")}</summary>
        <div className={styles.advanced}>
          {controls(FUR_CONTROLS.slice(8).filter(control => !["shells", "resolution", "fps"].includes(control.key)))}
          <div className={styles.choices} aria-label={rawText.text(rawLocale, "graphicsPreset")}>
            <button type="button" onClick={() => change(FUR_PRESETS.fine)}>{rawText.text(rawLocale, "restoreDefaultAppearance")}</button>
          </div>
          <label className={styles.motion}>{rawText.rich(rawLocale, "continuousAnimation", { part1: richValue((<input type="checkbox" checked={animate} onChange={event => setAnimate(event.currentTarget.checked)} />)) })}</label>
          <p className={styles.metrics}>{metrics || rawText.text(rawLocale, "waitingForFrame")}</p>
          <p className={styles.note}>{rawText.text(rawLocale, "highQualityUses64FurLayersOtherModesFollow")}</p>
          <div className={styles.choices}>
            <button type="button" onClick={exportSettings}>{rawText.text(rawLocale, "exportParameters")}</button>
            <button type="button" onClick={() => fileRef.current?.click()}>{rawText.text(rawLocale, "importParameters")}</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label={rawText.text(rawLocale, "importPlushParameters")} onChange={async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (file.size > 32_768) { setStatus("fileTooLarge"); return; }
            try { save(readSettings(JSON.parse(await file.text()))); }
            catch { setStatus("invalidFile"); }
          }} />
          <p className={styles.note}>{rawText.text(rawLocale, "savedAutomaticallyAndSyncedToTheAssistantPersonaCard")}</p>
        </div>
      </details>
      <p className={styles.note} role="status">{status ? rawText.text(rawLocale, status) : ""}</p>
    </section>}
  </>;
}
