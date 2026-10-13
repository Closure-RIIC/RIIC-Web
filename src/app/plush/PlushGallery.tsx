"use client";

// @refresh reset
// Recreate the WebGL lifecycle and hook state together during development edits.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BUILTIN_AGENT_PERSONAS } from "@/agent-personas";
import { FurAvatar } from "@/components/agent/ClosureFurAvatar";
import { FurSettingsContext } from "@/components/agent/FurSettingsContext";
import { FUR_CONTROLS, FUR_PRESETS, FUR_STORAGE_KEY, galleryFurSettings, normalizeFurSettings, type FurSettings } from "@/components/agent/fur-settings";
import { notifyFurSettingsChanged } from "@/components/agent/fur-settings-store";
import { normalizeFurPerformanceMode, type FurPerformanceMode } from "@/components/agent/fur-performance";
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
const performanceDescriptions: Record<FurPerformanceMode, string> = {
  auto: "按设备表现调整画质；持续卡顿时会改用静态图。",
  quality: "保留完整毛绒细节与持续动画，耗电较高。",
  balanced: "减少绘制细节，闲置时暂停，触碰后恢复互动。",
  saver: "进一步减少细节与耗电，闲置时暂停。",
  static: "显示默认形象的静态图，关闭实时转头和按压。",
};

function readSettings(input: unknown): SettingsByPersona {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid settings");
  const data = input as Record<string, unknown>;
  if (![1, 2].includes(data.version as number) || !data.personas || typeof data.personas !== "object") throw new Error("invalid version");
  const personas = data.personas as Record<string, unknown>;
  return Object.fromEntries(companions.map(({ id }) => [id, personas[id] ? normalizeFurSettings(personas[id]) : FUR_PRESETS.fine]));
}

export function PlushGallery({ debug = false }: { debug?: boolean }) {
  const [settings, setSettings] = useState<SettingsByPersona>({});
  const [performanceMode, setPerformanceMode] = useFurPerformanceMode();
  const { selected, select, galleryRef, stageRef } = usePlushTransition(companionIds);
  const [open, setOpen] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [status, setStatus] = useState("");
  const [metrics, setMetrics] = useState("等待绘制");
  const fileRef = useRef<HTMLInputElement>(null);
  const values = useMemo(() => galleryFurSettings(settings[selected] ?? FUR_PRESETS.fine), [settings, selected]);
  const selectedIndex = companions.findIndex(persona => persona.id === selected);
  const persona = companions[selectedIndex];
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Hydrate browser-only preferences after the server's deterministic first render.
      if (stored) setSettings(readSettings(JSON.parse(stored)));
    } catch { setStatus("本地参数无法读取，可恢复原始参数。"); }
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
      const interval = furFrameMs ? ` · 绘制完成 ${furFrameMs} ms` : "";
      setMetrics(furReady !== "true" ? "3D 加载中或已回退静态图" :
        `${furWidth ?? furPixels} × ${furPixels} px · ${fps.toFixed(0)} fps · ${furRenderer === "webgl" ? "CPU 提交" : "绘制等待"} ${furDrawMs} ms${gpu}${interval} · ${furMotion === "animated" ? "动态绘制" : "静止 / 暂停"}`);
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [debug, open, selected, galleryRef]);

  const save = (next: SettingsByPersona) => {
    setSettings(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, personas: next })); notifyFurSettingsChanged(); setStatus(""); }
    catch { setStatus("已应用；浏览器存储不可用，可导出参数保存。"); }
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
      <label htmlFor={`fur-${control.key}`}>{control.label}</label>
      <input id={`fur-${control.key}`} type="range" min={control.min} max={control.max} step={control.step}
        value={values[control.key]} onChange={event => change({ ...values, [control.key]: event.currentTarget.valueAsNumber })} />
      <output htmlFor={`fur-${control.key}`}>{values[control.key].toFixed(control.step === 1 ? 0 : 2)}</output>
    </div>)}
  </div>;

  return <>
    <main ref={galleryRef} className={styles.gallery} data-debug={debug ? "true" : undefined} aria-label="毛绒玩具展示">
      <article ref={stageRef} className={styles.stage} data-plush-card={persona.id} aria-label={persona.name}
        style={{ "--plush-zoom": values.zoom } as CSSProperties}>
        <div className={styles.shadow} data-plush-backdrop aria-hidden="true" />
        <svg className={`${styles.name} ${companionThemes[persona.theme]}`} data-plush-backdrop data-plush-name={persona.id}
          width={persona.name.length * 100} height="110" viewBox={`0 0 ${persona.name.length * 100} 110`}
          preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <text x="50%" y="55" textAnchor="middle" dominantBaseline="central" fontSize="100" fontWeight="900"
            textLength={persona.name.length * 100} lengthAdjust="spacingAndGlyphs" fill="currentColor">{persona.name}</text>
        </svg>
        <div className={styles.plush} role="img" aria-label={`${persona.name}毛绒形象`}>
          <FurSettingsContext.Provider value={values}>
            <FurAvatar variant={persona.avatar ?? "closure"} nextVariant={companions[(selectedIndex + 1) % companions.length].avatar ?? "closure"} active={animate} fullWidth />
          </FurSettingsContext.Provider>
        </div>
      </article>
    </main>
    <div ref={pickerRef} className={styles.picker} role="toolbar" aria-label="切换毛绒角色"
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
      {companions.map(item => <button type="button" key={item.id} aria-label={item.name} title={item.name}
        tabIndex={selected === item.id ? 0 : -1} aria-pressed={selected === item.id} onClick={() => select(item.id)}>
        <span className={styles.icon} aria-hidden="true"><FurAvatar variant={item.avatar ?? "closure"} preview /></span>
      </button>)}
    </div>
    <details className={styles.performance} aria-label="毛绒性能设置" open={!debug}>
      <summary>画质与耗电设置</summary>
      <div className={styles.performanceControls}>
        <label htmlFor="fur-performance-mode">画质与耗电</label>
        <select id="fur-performance-mode" value={performanceMode} aria-describedby="fur-performance-description"
          onChange={event => setPerformanceMode(normalizeFurPerformanceMode(event.currentTarget.value))}>
          <option value="auto">自动</option>
          <option value="quality">高画质</option>
          <option value="balanced">均衡</option>
          <option value="saver">节能</option>
          <option value="static">静态</option>
        </select>
        {performanceMode === "auto" && <button type="button" onClick={() => {
          galleryRef.current?.querySelector<HTMLElement>("[data-fur-avatar]")?.dispatchEvent(new Event("fur-retry"));
        }}>重新检测性能</button>}
      </div>
      <p id="fur-performance-description">{performanceDescriptions[performanceMode]}偏好单独保存，不改变角色外观参数。</p>
    </details>
    {debug && <section className={styles.lab} aria-label="毛绒调试面板">
      {controls(FUR_CONTROLS.slice(0, 8))}
      <details className={styles.more} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>更多设置</summary>
        <div className={styles.advanced}>
          {controls(FUR_CONTROLS.slice(8).filter(control => !["shells", "resolution", "fps"].includes(control.key)))}
          <div className={styles.choices} aria-label="画质预设">
            <button type="button" onClick={() => change(FUR_PRESETS.fine)}>恢复默认形象</button>
          </div>
          <label className={styles.motion}><input type="checkbox" checked={animate} onChange={event => setAnimate(event.currentTarget.checked)} />持续动画</label>
          <p className={styles.metrics}>{metrics}</p>
          <p className={styles.note}>高画质使用 64 层毛发；其他模式按性能预算绘制。毛发参数以原形象为 1 倍；系统减少动态效果优先。</p>
          <div className={styles.choices}>
            <button type="button" onClick={exportSettings}>导出参数</button>
            <button type="button" onClick={() => fileRef.current?.click()}>导入参数</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="导入毛绒参数" onChange={async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (file.size > 32_768) { setStatus("参数文件不能超过 32 KB。"); return; }
            try { save(readSettings(JSON.parse(await file.text()))); }
            catch { setStatus("文件格式不正确，请选择本展示页导出的 JSON。"); }
          }} />
          <p className={styles.note}>自动保存，并同步至当前浏览器的 Agent 人设卡与对话头像。Agent 使用轻量画质。</p>
        </div>
      </details>
      <p className={styles.note} role="status">{status}</p>
    </section>}
  </>;
}
