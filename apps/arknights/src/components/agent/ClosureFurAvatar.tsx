"use client";

import { useContext, useEffect, useId, useRef, useState } from "react";
import type { acquireFurRenderer, FurAvatarVariant } from "./fur-avatar-renderer";
import { FurSettingsContext } from "./FurSettingsContext";
import { useAgentFurSettings } from "./fur-settings-store";
import type { AgentFurSurface } from "./fur-settings";
import { plushFurInertia, plushGazeStep } from "./plush-motion";
import { agentFrameInterval, motionResolutionScale } from "./fur-frame-budget";
import { performanceSettings, resolvePerformanceTier } from "./fur-performance";
import { readFurPerformanceMode, useFurPerformanceMode } from "./fur-performance-store";
import { newFurQualityObservation, observeFurQuality } from "./fur-adaptive-quality";

// One interactive avatar at a time, even when the history contains many replies.
const interactionOwners = new EventTarget();
let interactionOwner: HTMLElement | null = null;

export function ClosureFurAvatar({ active = false }: { active?: boolean }) {
  return <FurAvatar active={active} variant="closure" />;
}

export function SilverashFurAvatar({ active = false }: { active?: boolean }) {
  return <FurAvatar active={active} variant="silverash" />;
}

export function ExusiaiFurAvatar({ active = false }: { active?: boolean }) {
  return <FurAvatar active={active} variant="exusiai" />;
}

export function SaileachFurAvatar({ active = false }: { active?: boolean }) {
  return <FurAvatar active={active} variant="saileach" />;
}

export function MountainFurAvatar({ active = false }: { active?: boolean }) {
  return <FurAvatar active={active} variant="mountain" />;
}

export function FurAvatar({ active = false, variant, preview = false, fullWidth = false, nextVariant, surface = "chat" }: { active?: boolean; variant: FurAvatarVariant; preview?: boolean; fullWidth?: boolean; nextVariant?: FurAvatarVariant; surface?: AgentFurSurface }) {
  const gradientId = useId().replaceAll(":", "");
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLSpanElement>(null);
  const staticImageRef = useRef<HTMLImageElement>(null);
  const [performanceMode] = useFurPerformanceMode();
  const [retry, setRetry] = useState(0);
  const activeRef = useRef(active);
  const variantRef = useRef(variant);
  const override = useContext(FurSettingsContext);
  const agentSettings = useAgentFurSettings(variant, !preview && !override, surface);
  const settings = override ?? agentSettings;
  const gallery = Boolean(override);
  const settingsRef = useRef(settings);
  const nextVariantRef = useRef(nextVariant);

  useEffect(() => {
    const root = rootRef.current;
    const restart = () => setRetry(value => value + 1);
    root?.addEventListener("fur-retry", restart);
    return () => root?.removeEventListener("fur-retry", restart);
  }, []);

  useEffect(() => { nextVariantRef.current = nextVariant; }, [nextVariant]);

  useEffect(() => {
    variantRef.current = variant;
    rootRef.current?.dispatchEvent(new Event("fur-variant"));
  }, [variant]);

  useEffect(() => {
    settingsRef.current = settings;
    rootRef.current?.dispatchEvent(new Event("fur-settings"));
  }, [settings]);

  useEffect(() => {
    activeRef.current = active;
    rootRef.current?.dispatchEvent(new Event("fur-activity"));
  }, [active]);

  useEffect(() => {
    if (preview) return;
    const root = rootRef.current, mount = canvasRef.current;
    if (!root || !mount) return;
    // Read synchronously: persisted static mode must not initialize WebGL during hydration.
    const mode = readFurPerformanceMode();
    let tier = resolvePerformanceTier(mode, false);
    const observation = newFurQualityObservation();
    root.dataset.furPerformance = tier;
    root.dataset.furReady = "false";
    delete root.dataset.furStaticPreview;
    const showStatic = () => {
      root.dataset.furPerformance = "static";
      root.dataset.furMotion = "static";
      root.dataset.furReady = "false";
      root.dataset.furRenderer = "static";
      if (staticImageRef.current) staticImageRef.current.src = `/images/plush/${variantRef.current}.webp`;
      root.dispatchEvent(new Event("fur-rendered", { bubbles: true }));
    };
    if (tier === "static") {
      showStatic();
      const changed = () => { delete root.dataset.furStaticPreview; showStatic(); };
      root.addEventListener("fur-variant", changed);
      return () => root.removeEventListener("fur-variant", changed);
    }
    let canvas = document.createElement("canvas");
    const rendererCanvas = canvas;
    canvas.className = fullWidth ? "absolute left-0 -top-[22%] h-[144%] w-full" : "absolute -left-[22%] -top-[22%] size-[144%]";
    mount.append(canvas);
    let context = gallery ? null : canvas.getContext("2d");
    if (!gallery && !context) { canvas.remove(); showStatic(); return; }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let visible = gallery, disposed = false, pressed = false, hovering = false;
    let transition: { animation: Animation; width: number; direction: number } | null = null;
    let inertiaX = 0;
    let frame = 0, lastFrame = 0, targetX = 0, targetY = 0;
    let yaw = 0, pitch = 0, press = 0, pressVelocity = 0;
    let lastX = 0, lastY = 0, lagX = 0, lagY = 0;
    let pixels = 0, canvasWidth = 0, drawCost = 0;
    let presentationWidth = 0, presentationHeight = 0;
    let drawing = false, needsFrame = false, revision = 0;
    let announcedVariant: FurAvatarVariant | undefined;
    let engine: Awaited<ReturnType<typeof acquireFurRenderer>> | undefined;
    let warmTimer: ReturnType<typeof setTimeout> | undefined;
    let submittedFrames = 0;
    let resolutionScale = 1, lastQualityUpdate = 0, lastInteraction = -Infinity;
    let wasMoving = false;
    const runtimeSettings = () => performanceSettings(settingsRef.current, tier, gallery, surface);
    const continuous = () => tier === "quality" && activeRef.current;
    const enterStatic = () => {
      tier = "static";
      revision++;
      clearTimeout(warmTimer);
      stop();
      releaseOwner();
      engine?.release();
      engine = undefined;
      mount.replaceChildren();
      showStatic();
    };
    const prewarm = () => {
      // Software shader compilation competes with the current frame on the CPU.
      // Compile its next character only when selected, not during idle settling.
      if (disposed || tier !== "quality" || !gallery || !engine?.direct || document.hidden || !nextVariantRef.current) return;
      if (hovering || pressed || transition || drawing || !engine.ready()) {
        warmTimer = setTimeout(prewarm, 1000); return;
      }
      void engine.prewarm(nextVariantRef.current).catch(() => {});
    };

    const paint = async (time: number, animated: boolean) => {
      if (!engine) return false;
      const currentRevision = revision;
      try {
        const started = performance.now();
        const effective = runtimeSettings();
        const drawn = await engine.draw(context, pixels, { yaw, pitch, press, lagX, lagY, inertiaX, time: time / 1000, active: animated && continuous() }, variantRef.current, effective, () => !disposed && currentRevision === revision, canvasWidth, { width: presentationWidth, height: presentationHeight }, tier === "quality" ? "full" : "lite");
        if (disposed || currentRevision !== revision) return true;
        // Exclude the first draw/compile for both gallery and chat. Shared chat
        // rendering reports this completed frame's GPU wait + copy cost, without
        // time spent queued behind other portraits inflating its steady budget.
        if (drawn && announcedVariant === variantRef.current) {
          const completedCost = gallery ? performance.now() - started : engine.frameMs();
          drawCost = drawCost * 0.75 + completedCost * 0.25;
        }
        root.dataset.furFrames = String(++submittedFrames);
        root.dataset.furResolutionScale = resolutionScale.toFixed(2);
        root.dataset.furPerformance = tier;
        root.dataset.furFrameMs = engine.frameMs().toFixed(1);
        const gpuMs = engine.gpuMs();
        if (gpuMs !== null) root.dataset.furGpuMs = gpuMs.toFixed(1);
        else delete root.dataset.furGpuMs;
        root.dataset.furRenderer = engine.direct ? "webgl" : gallery ? "software-2d" : "shared-2d";
        if (settingsRef.current) {
          root.dataset.furDrawMs = drawCost.toFixed(1);
          root.dataset.furPixels = String(pixels);
          root.dataset.furWidth = String(canvasWidth);
          root.dataset.furShells = String(effective.shells);
          root.dataset.furLength = String(settingsRef.current.length);
          root.dataset.furFps = String(effective.fps);
          root.dataset.furQuality = gallery ? "gallery" : "agent";
          root.dataset.furInertia = inertiaX.toFixed(3);
          root.dataset.furYaw = yaw.toFixed(3);
          root.dataset.furPitch = pitch.toFixed(3);
          root.dataset.furPress = press.toFixed(3);
        }
        root.dataset.furReady = String(drawn);
        if (announcedVariant !== variantRef.current) {
          announcedVariant = variantRef.current;
          root.dispatchEvent(new Event("fur-rendered", { bubbles: true }));
          clearTimeout(warmTimer);
          if (gallery) warmTimer = setTimeout(prewarm, 1500);
        }
        if (!drawn) context?.clearRect(0, 0, canvas.width, canvas.height);
        return drawn;
      } catch {
        if (disposed || currentRevision !== revision) return true;
        root.dataset.furReady = "false";
        context?.clearRect(0, 0, canvas.width, canvas.height);
        if (announcedVariant !== variantRef.current) {
          announcedVariant = variantRef.current;
          root.dispatchEvent(new Event("fur-rendered", { bubbles: true }));
        }
        return false;
      }
    };
    const stop = () => { window.cancelAnimationFrame(frame); frame = 0; lastFrame = 0; };
    const render = async (time: number) => {
      frame = 0;
      if (drawing) { needsFrame = true; return; }
      if (disposed || (!visible && !transition) || document.hidden) { root.dataset.furMotion = "paused"; return; }
      if (tier === "static") { showStatic(); return; }
      if (!engine) return;
      if (!engine.ready()) { frame = requestAnimationFrame(render); return; }
      const interactive = interactionOwner === root;
      // The hovered/pressed portrait follows its chosen FPS. Awaiting drawing
      // already prevents overlapping work; only background motion needs extra
      // throttling to leave time for streaming text on slow/software WebGL.
      const interval = gallery ? 1000 / runtimeSettings().fps : agentFrameInterval(runtimeSettings().fps, drawCost, interactive);
      // Allow RAF timestamp jitter around 60 Hz rather than accidentally halving it.
      if (lastFrame && time - lastFrame < interval - 1) { frame = requestAnimationFrame(render); return; }
      // On a slow GPU, an initial near-rest pose would consume an entire frame
      // before any press became visible. Account for its measured presentation latency.
      const dt = lastFrame ? Math.min((time - lastFrame) / 1000, 5) : Math.max(1 / 30, Math.min(0.5, drawCost / 1000));
      lastFrame = time;
      const animate = (!reduce.matches || (gallery && pressed)) && (!interactionOwner || interactive);
      const working = animate && continuous();
      const nextYaw = animate ? (interactive ? targetX : 0) + (working ? Math.sin(time / 1100) * 0.045 : 0) : 0;
      const nextPitch = animate ? (interactive ? targetY : 0) + (working ? Math.sin(time / 1400) * 0.025 : 0) : 0;
      const targetInertia = animate && transition ? plushFurInertia(Number(transition.animation.currentTime ?? 0), transition.width, transition.direction) : 0;
      inertiaX += (targetInertia - inertiaX) * (1 - Math.exp(-12 * dt));
      if (!transition && Math.abs(inertiaX) < 0.001) inertiaX = 0;
      // A frame-sized lag update leaves a full stale trail after a long GPU
      // frame. Exact integration settles both channels in real elapsed time.
      const horizontal = plushGazeStep(yaw, lagX, nextYaw, dt);
      const vertical = plushGazeStep(pitch, lagY, nextPitch, dt);
      yaw = horizontal.position; lagX = horizontal.lag;
      pitch = vertical.position; lagY = vertical.lag;
      // A damped spring keeps a second press continuous with the first release.
      const targetPress = animate && interactive && pressed ? 1 : 0;
      // Exact damped-spring step: preserve real elapsed time even when rendering
      // is slow, without the instability of a large Euler integration step.
      const frequency = Math.sqrt(75), offset = press - targetPress;
      const amplitude = (pressVelocity + 5 * offset) / frequency;
      const decay = Math.exp(-5 * dt), cosine = Math.cos(frequency * dt), sine = Math.sin(frequency * dt);
      press = targetPress + decay * (offset * cosine + amplitude * sine);
      pressVelocity = decay * ((amplitude * frequency - 5 * offset) * cosine - (offset * frequency + 5 * amplitude) * sine);
      if (!animate) { yaw = 0; pitch = 0; press = 0; pressVelocity = 0; lagX = 0; lagY = 0; inertiaX = 0; }
      const settling = Math.abs(yaw - nextYaw) + Math.abs(pitch - nextPitch) + Math.abs(press - targetPress) + Math.abs(pressVelocity) + Math.abs(lagX) + Math.abs(lagY) + Math.abs(inertiaX) > 0.003;
      if (gallery && tier === "quality") {
        const interactionSettling = Math.abs(yaw - nextYaw) + Math.abs(pitch - nextPitch) + Math.abs(press - targetPress) + Math.abs(pressVelocity) * 0.1 + Math.abs(inertiaX) > 0.02;
        // A press can arrive while a slow software frame is still rendering.
        // Consume it on the next quality update even if its grace period elapsed.
        const moving = Boolean(transition) || lastInteraction > lastQualityUpdate || time - lastInteraction < 180 || (resolutionScale < 1 && interactionSettling);
        if (!moving || !wasMoving || time - lastQualityUpdate > 500) {
          // During one gesture only step down if needed. Recover once it has
          // settled, rather than pumping sharpness as individual frames vary.
          const nextScale = moving ? Math.min(resolutionScale, motionResolutionScale(engine.frameMs(), resolutionScale)) : 1;
          if (Math.abs(nextScale - resolutionScale) >= 0.1 || nextScale === 1) {
            if (nextScale !== resolutionScale) { resolutionScale = nextScale; resizeCanvas(); }
          }
          lastQualityUpdate = time;
        }
        wasMoving = moving;
      }
      const restoringQuality = gallery && resolutionScale < 1;
      const motion = reduce.matches ? "still" : working || settling || transition || restoringQuality ? "animated" : "idle";
      drawing = true;
      needsFrame = false;
      const drawn = await paint(time, animate);
      drawing = false;
      if (disposed) return;
      if (mode === "auto" && drawn) {
        // GPU duration avoids RAF polling quantization; software copy cost is included.
        const measuredMs = engine.direct ? engine.gpuMs() ?? engine.frameMs() : engine.frameMs();
        const nextTier = observeFurQuality(tier, observation, measuredMs, performance.now());
        if (nextTier !== tier) {
          if (nextTier === "static") { enterStatic(); return; }
          tier = nextTier; resolutionScale = 1; wasMoving = false;
          clearTimeout(warmTimer);
          resizeCanvas();
          needsFrame = true;
        }
      }
      // Publish the state of the frame actually presented, not one still in the
      // GPU queue. A newer pose requested during this draw must settle first.
      if (drawn && !needsFrame) root.dataset.furMotion = motion;
      if (!drawn && !needsFrame) { root.dataset.furMotion = "fallback"; return; }
      if (!frame && (needsFrame || restoringQuality || (animate && (working || settling || transition)))) frame = requestAnimationFrame(render);
    };
    const wake = () => {
      if (disposed) return;
      if (tier === "static") { showStatic(); return; }
      // Idle means the requested pose has actually been presented, including
      // the final full-resolution frame after an interaction.
      root.dataset.furMotion = "animated";
      if (drawing) { needsFrame = true; return; }
      if (!frame) { lastFrame = 0; frame = requestAnimationFrame(render); }
    };
    const ownerChange = () => {
      if (disposed || tier === "static" || (!visible && !transition) || document.hidden) return;
      // A new owner must not enqueue every already-idle history portrait. Keep
      // the old owner's final rest pose and resume active animation on release.
      const awayFromRest = Math.abs(yaw) + Math.abs(pitch) + Math.abs(press)
        + Math.abs(pressVelocity) + Math.abs(lagX) + Math.abs(lagY) + Math.abs(inertiaX) > 0.003;
      const resumeActive = !interactionOwner && continuous() && !reduce.matches;
      if (interactionOwner === root || awayFromRest || resumeActive || transition) wake();
    };
    const reset = () => { pressed = false; hovering = false; targetX = 0; targetY = 0; };
    const releaseOwner = () => {
      if (interactionOwner === root) { interactionOwner = null; interactionOwners.dispatchEvent(new Event("change")); }
    };
    const claim = () => {
      if (tier === "static" || (reduce.matches && !gallery) || interactionOwner === root) return;
      interactionOwner = root;
      interactionOwners.dispatchEvent(new Event("change"));
    };
    const move = (event: PointerEvent) => {
      if (tier === "static") return;
      if (!(gallery && pressed) && (event.pointerType !== "mouse" || !finePointer.matches || reduce.matches)) return;
      hovering = true;
      claim();
      if (pressed) {
        // Passive gaze keeps its authored resolution: brief cursor pauses must
        // not repeatedly switch fur coverage between half and full sampling.
        lastInteraction = performance.now();
        targetX += (event.clientX - lastX) * 0.018;
        targetY = Math.max(-0.6, Math.min(0.6, targetY + (event.clientY - lastY) * 0.01));
      } else {
        const bounds = root.getBoundingClientRect();
        // A small portrait should acknowledge the pointer without turning its
        // asymmetric silhouette away. Full rotations remain available by drag.
        const yawRange = gallery ? 0.55 : 0.14;
        const pitchRange = gallery ? 0.34 : 0.10;
        targetX = Math.max(-yawRange, Math.min(yawRange, ((event.clientX - bounds.left) / bounds.width - 0.5) * yawRange * 2));
        targetY = Math.max(-pitchRange, Math.min(pitchRange, ((event.clientY - bounds.top) / bounds.height - 0.5) * pitchRange * 2));
      }
      lastX = event.clientX;
      lastY = event.clientY;
      wake();
    };
    const down = (event: PointerEvent) => {
      if (tier === "static" || event.button !== 0 || (reduce.matches && !gallery)) return;
      pressed = true;
      lastInteraction = performance.now();
      lastX = event.clientX;
      lastY = event.clientY;
      if (gallery || event.pointerType === "mouse") root.setPointerCapture(event.pointerId);
      claim();
      wake();
    };
    const up = () => {
      if (!pressed) return;
      pressed = false;
      lastInteraction = performance.now();
      if (!hovering) releaseOwner();
      wake();
    };
    const leave = () => { reset(); releaseOwner(); wake(); };
    const resizeCanvas = () => {
      const bounds = root.getBoundingClientRect();
      const aspect = fullWidth ? bounds.width / Math.max(1, bounds.height * 1.44) : 1;
      const requestedRatio = Math.min(devicePixelRatio || 1, 2) * runtimeSettings().resolution;
      const requested = (fullWidth ? bounds.height : bounds.width) * 1.44 * (gallery ? Math.min(2, requestedRatio) : requestedRatio);
      // Give fullscreen fur enough samples instead of stretching the avatar's
      // old 1 MP budget. Cap gallery at 4 MP / 4096 wide and Agent at 256 square.
      const limit = gallery ? Math.min(2048, 2048 / Math.sqrt(aspect), 4096 / aspect) : 256;
      const fullSize = settingsRef.current ? Math.min(limit, requested) : requested;
      presentationHeight = Math.max(1, Math.round(fullSize));
      presentationWidth = Math.max(1, Math.round(fullSize * aspect));
      const next = Math.max(1, Math.round(fullSize * resolutionScale));
      const width = Math.max(1, Math.round(next * aspect));
      if (next === pixels && canvasWidth === width) return;
      pixels = next;
      canvasWidth = width;
      revision++;
      if (context && Math.abs(canvas.width / canvas.height - width / pixels) > 0.005) {
        // A viewport aspect change must fit immediately, even on a software GPU.
        // Preserve its old bitmap while the correctly projected frame is queued.
        const previous = document.createElement("canvas");
        previous.width = canvas.width; previous.height = canvas.height;
        previous.getContext("2d", { willReadFrequently: true })?.drawImage(canvas, 0, 0);
        canvas.width = width; canvas.height = pixels;
        context.drawImage(previous, 0, 0, width, pixels);
      }
      // The renderer owns physical resizing. WebGL waits for its previous GPU
      // frame; copied portraits keep their last bitmap until the new one is ready.
    };
    const resize = () => { resizeCanvas(); wake(); };
    const visibility = () => {
      if (document.hidden) { stop(); reset(); releaseOwner(); root.dataset.furMotion = "paused"; }
      else wake();
    };
    const motionChange = () => { reset(); releaseOwner(); wake(); };
    const transitionChange = (event: Event) => {
      transition = (event as CustomEvent<typeof transition>).detail || null;
      if (transition) { reset(); releaseOwner(); }
      wake();
    };
    const settingsChange = () => { revision++; resize(); wake(); };
    const variantChange = () => {
      clearTimeout(warmTimer);
      revision++;
      reset(); releaseOwner();
      yaw = pitch = press = pressVelocity = lagX = lagY = 0;
      inertiaX = 0;
      root.dataset.furReady = "false";
      announcedVariant = undefined;
      if (tier === "static") { delete root.dataset.furStaticPreview; showStatic(); return; }
      context?.clearRect(0, 0, canvas.width, canvas.height);
      wake();
    };
    const snapshot = (event: Event) => {
      const target = (event as CustomEvent<CanvasRenderingContext2D>).detail;
      if (gallery && target) {
        if (engine?.direct) engine.snapshot(target);
        else target.drawImage(canvas, 0, 0);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      // The dedicated gallery fills the viewport. Layout changes in its debug
      // panel and orbital transforms must not suspend the sole live model.
      // Browser visibility still pauses it; Agent portraits retain culling.
      if (gallery) return;
      visible = entry?.isIntersecting ?? false;
      if (visible || transition) wake();
      else { stop(); reset(); releaseOwner(); root.dataset.furMotion = "paused"; }
    });
    const resizer = new ResizeObserver(resize);
    if (!gallery) observer.observe(root);
    resizer.observe(root);
    resize();
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointercancel", leave);
    root.addEventListener("fur-activity", wake);
    root.addEventListener("fur-settings", settingsChange);
    root.addEventListener("fur-variant", variantChange);
    root.addEventListener("fur-transition", transitionChange);
    root.addEventListener("fur-snapshot", snapshot);
    rendererCanvas.addEventListener("fur-context-restored", wake);
    window.addEventListener("pointerup", up);
    document.addEventListener("visibilitychange", visibility);
    reduce.addEventListener("change", motionChange);
    interactionOwners.addEventListener("change", ownerChange);
    void import("./fur-avatar-renderer").then(async ({ acquireFurRenderer, acquireGalleryFurRenderer }) => {
      if (disposed) return;
      const acquired = await (gallery ? acquireGalleryFurRenderer(canvas) : acquireFurRenderer());
      if (disposed) { acquired.release(); return; }
      engine = acquired;
      tier = resolvePerformanceTier(mode, acquired.software);
      root.dataset.furPerformance = tier;
      resizeCanvas();
      if (acquired.surface && acquired.surface !== canvas) {
        acquired.surface.className = canvas.className;
        canvas = acquired.surface;
        // Software fallback must not send its bitmap back through the busy GPU
        // compositor. Keep presentation and viewport resizing on a CPU surface.
        context = canvas.getContext("2d", { willReadFrequently: true });
        mount.replaceChildren(canvas);
      }
      if (!acquired.direct) { canvas.width = canvasWidth; canvas.height = pixels; }
      wake();
    }).catch(() => { if (!disposed) enterStatic(); });
    return () => {
      disposed = true;
      clearTimeout(warmTimer);
      stop();
      observer.disconnect();
      resizer.disconnect();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointercancel", leave);
      root.removeEventListener("fur-activity", wake);
      root.removeEventListener("fur-settings", settingsChange);
      root.removeEventListener("fur-variant", variantChange);
      root.removeEventListener("fur-transition", transitionChange);
      root.removeEventListener("fur-snapshot", snapshot);
      rendererCanvas.removeEventListener("fur-context-restored", wake);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("visibilitychange", visibility);
      reduce.removeEventListener("change", motionChange);
      interactionOwners.removeEventListener("change", ownerChange);
      releaseOwner();
      engine?.release();
      mount.replaceChildren();
    };
  }, [preview, fullWidth, gallery, performanceMode, retry, surface]);

  return <span ref={rootRef} data-fur-avatar={preview ? undefined : variant} data-fur-preview={preview ? variant : undefined} data-closure-fur-avatar={variant === "closure" ? "" : undefined} data-silverash-fur-avatar={variant === "silverash" ? "" : undefined} data-fur-ready="false" data-fur-motion="idle" className={`group/fur relative block size-full ${gallery ? "touch-none" : "touch-pan-y"} cursor-grab active:cursor-grabbing`}>
    {!preview && <img ref={staticImageRef} alt="" aria-hidden="true" draggable={false}
      onLoad={() => { if (rootRef.current?.dataset.furPerformance === "static") rootRef.current.dataset.furStaticPreview = "true"; }}
      onError={() => { if (rootRef.current) delete rootRef.current.dataset.furStaticPreview; }}
      className="pointer-events-none absolute -left-[22%] -top-[22%] hidden size-[144%] object-contain group-data-[fur-performance=static]/fur:block" />}
    <svg viewBox="0 0 100 100" aria-hidden="true" className="pointer-events-none absolute -left-[22%] -top-[22%] size-[144%] group-data-[fur-ready=true]/fur:invisible group-data-[fur-static-preview=true]/fur:invisible" data-fur-fallback>
      {variant === "mountain" ? <g data-mountain-fallback transform="translate(50 50) scale(1.10) translate(-50 -50)">
        <defs><radialGradient id={`${gradientId}-tiger`}><stop stopColor="#f8f8f5" /><stop offset="1" stopColor="#c8cbca" /></radialGradient></defs>
        <path d="M62 70Q85 76 83 53Q82 45 76 49" fill="none" stroke="#dfe1de" strokeWidth="7" strokeLinecap="round" />
        <path d="M77 70L82 66M83 58L82 53M79 48L76 49" fill="none" stroke="#383c40" strokeWidth="6" strokeLinecap="round" />
        <g fill="#383c40"><ellipse cx="32" cy="32" rx="8.5" ry="9" /><ellipse cx="68" cy="32" rx="8.5" ry="9" /></g>
        <g fill="#ededeb"><ellipse cx="32" cy="33" rx="5.1" ry="5.6" /><ellipse cx="68" cy="33" rx="5.1" ry="5.6" /></g>
        <ellipse cx="50" cy="54" rx="28" ry="27" fill={`url(#${gradientId}-tiger)`} />
        <g fill="#35383c">
          <path d="M45.5 27L51 28L49.5 32L53 33L49 40L50 35L46.5 34L48 30Z" />
          <path d="M31 34L37 35L39 33L42 38L47 40L40 39L38 37L32 38ZM67 33L63 36L59 35L58 39L54 41L61 39L62 38L69 37Z" />
          <path d="M22 42L28 45L30 43L33 47L38 49L31 48L29 46L25 48L22 47ZM78 43L73 43L71 46L68 45L63 49L70 48L72 49L74 46L78 47Z" />
          <path d="M22 54L27 56L29 53L32 58L36 60L30 59L28 58L25 61L22 59ZM78 57L73 56L71 59L68 58L64 62L71 61L73 63L75 60L78 62Z" />
          <path d="M25 65L29 64L31 66L34 64L39 66L33 68L32 71L28 69L27 72ZM74 68L70 66L68 69L65 67L62 69L67 71L70 74L72 71L73 73Z" />
        </g>
        <g fill="#78aabd"><ellipse cx="41.3" cy="53" rx="3.4" ry="4.3" /><ellipse cx="58.7" cy="53" rx="3.4" ry="4.3" /></g>
      </g> : variant === "saileach" ? <g data-saileach-fallback transform="translate(50 50) scale(1.16) translate(-50 -50)">
        <defs>
          <radialGradient id={`${gradientId}-gold`}><stop stopColor="#f7e2a9" /><stop offset="1" stopColor="#d8b86d" /></radialGradient>
          <linearGradient id={`${gradientId}-horn`} x1="1" y1="1" x2="0" y2="0"><stop stopColor="#51647f" /><stop offset="1" stopColor="#e1dfcd" /></linearGradient>
          <pattern id={`${gradientId}-headband`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#304768" />
            <path d="M0 3L3 0L6 3L3 6Z" fill="none" stroke="#7892ae" strokeWidth="0.5" />
          </pattern>
        </defs>
        <ellipse cx="50" cy="53" rx="27" ry="27" fill={`url(#${gradientId}-gold)`} />
        <g fill="#97c9f2" stroke="#526481" strokeWidth="0.37"><ellipse cx="42" cy="54.4" rx="3.31" ry="4.68" /><ellipse cx="58" cy="54.4" rx="3.31" ry="4.68" /></g>
        <path d="M30 65Q22 44 38 32Q55 23 68 36Q76 48 68 65Q65 59 63 46L56 48L53 44L49 49L46 43Q39 51 34 48L34 65Z" fill="#dcb867" />
        <path d="M31 39Q50 24 69 39L70 43Q50 31 30 43Z" fill={`url(#${gradientId}-headband)`} />
        <path d="M43 35L46 32L49 35L46 38Z" fill="#f9dc8a" />
        {[-1, 1].map(side => <g key={side} transform={side < 0 ? "translate(100 0) scale(-1 1)" : undefined}>
          <path d="M70 47C79 43 77 34 70 32Q66 31 63 37Q69 34 71 39Q74 43 68 46Z" fill={`url(#${gradientId}-horn)`} />
          <path d="M70 44Q73 45 75 43M72 41Q75 41 76 39M71 37Q74 37 75 35M68 34L70 32M65 35L66 33" fill="none" stroke="#52647c" strokeWidth="0.8" strokeLinecap="round" />
        </g>)}
        <path d="M71 54Q76 58 71 63Q77 68 72 74" fill="none" stroke="#e7c87e" strokeWidth="7" strokeLinecap="round" />
        <path d="M69 72L76 72" stroke="#304768" strokeWidth="3" strokeLinecap="round" />
      </g> : variant === "exusiai" ? <g transform="translate(50 50) scale(1.05) translate(-50 -50)">
        <defs>
          <linearGradient id={`${gradientId}-red`} x2="0" y2="1"><stop stopColor="#ff4b50" /><stop offset="1" stopColor="#e12b37" /></linearGradient>
          <linearGradient id={`${gradientId}-fringe`} x2="0" y2="1"><stop stopColor="#c82a3b" /><stop offset="1" stopColor="#a7192b" /></linearGradient>
          <linearGradient id={`${gradientId}-accessory`} x2="0" y2="1" colorInterpolation="linearRGB"><stop stopColor="#ffe000" /><stop offset="0.87" stopColor="#fff" /></linearGradient>
          <linearGradient id={`${gradientId}-halo`} x2="0" y2="1" colorInterpolation="linearRGB"><stop stopColor="#ffe000" /><stop offset="0.22" stopColor="#ffe000" /><stop offset="0.55" stopColor="#fff2a8" /></linearGradient>
        </defs>
        <ellipse data-plush-halo cx="50" cy="24" rx="23" ry="12.5" fill="none" stroke={`url(#${gradientId}-halo)`} strokeWidth="7.4" />
        <g data-plush-wings fill={`url(#${gradientId}-accessory)`}>
          <path d="M11 36L14 40L11 44L8 40Z" />
          <path d="M9 47L13 51L9 55L5 51Z" />
          <path d="M11 58L15 62L11 66L7 62Z" />
          <path d="M89 36L92 40L89 44L86 40Z" />
          <path d="M91 47L95 51L91 55L87 51Z" />
          <path d="M89 58L93 62L89 66L85 62Z" />
        </g>
        <ellipse cx="50" cy="54" rx="28" ry="27" fill={`url(#${gradientId}-red)`} />
        <path d="M33 62Q28 51 43 39Q55 37 66 51Q72 64 63 68Q42 72 33 62Z" fill="#f1d4ac" />
        <ellipse cx="41" cy="51" rx="4.6" ry="5.9" fill="#57392c" />
        <ellipse cx="41" cy="51" rx="3.9" ry="5.2" fill="#ffe02b" />
        <path d="M49 58L54 56.7Q54 63 51 64Q49 62 49 58Z" fill="#b66c57" />
        <path d="M31 65C22 56 25 38 41 33C55 27 73 37 73 50Q75 57 69 59L69 55Q68 63 59 65Q57 65 58 60Q58 57 56 54C49 55 42 47 43 40Q32 50 33 61L34 66Z" fill={`url(#${gradientId}-fringe)`} />
      </g> : variant === "silverash" ? <g transform="translate(50 50) scale(1.1) translate(-50 -50)">
        <defs>
          <linearGradient id={`${gradientId}-ears`} x2="0" y2="1"><stop stopColor="#4c5155" /><stop offset="1" stopColor="#c4c7c9" /></linearGradient>
          <linearGradient id={`${gradientId}-coat`} x2="0" y2="1"><stop stopColor="#bdc0c3" /><stop offset="1" stopColor="#f2f3f3" /></linearGradient>
          <linearGradient id={`${gradientId}-ruff`} x2="0" y2="1"><stop stopColor="#707070" /><stop offset="1" stopColor="#383838" /></linearGradient>
        </defs>
        <g transform="translate(-2 -3)">
          <path d="M61 66C80 78 91 62 84 51C81 46 76 49 77 54" fill="none" stroke="#d0d3d5" strokeWidth="9" strokeLinecap="round" />
          <path d="M71 70l2-5m8-2l5 1m-4-10l4-2" fill="none" stroke="#686e73" strokeWidth="2.7" strokeLinecap="round" />
        </g>
        <path d="M23 68Q17 63 18 55L15 47L21 50L18 40L25 46L26 36L31 43Q45 38 60 42L66 35L65 46L73 39L71 50L77 46L74 57Q75 64 69 68L65 59Q47 49 28 59Z" fill={`url(#${gradientId}-ruff)`} />
        <ellipse cx="30" cy="33" rx="10" ry="11" fill={`url(#${gradientId}-ears)`} transform="rotate(-10 30 33)" />
        <ellipse cx="62" cy="33" rx="10" ry="11" fill={`url(#${gradientId}-ears)`} transform="rotate(10 62 33)" />
        <ellipse cx="30" cy="35" rx="6.5" ry="8" fill="#f2f3f3" />
        <ellipse cx="62" cy="35" rx="6.5" ry="8" fill="#f2f3f3" />
        <ellipse cx="46" cy="54" rx="26" ry="24" fill={`url(#${gradientId}-coat)`} />
        <path d="M25 42C24 39 30 39 33 41L32 44C28 42 26 45 28 48L25 49C23 47 25 45 25 42ZM66 48C69 46 71 51 69 54C72 58 68 61 65 58C63 56 66 53 64 51ZM29 63C32 60 36 62 37 65C41 67 36 71 33 70C31 73 27 69 28 67C25 65 27 63 29 63ZM51 69C54 65 59 68 60 71C63 73 59 76 56 75L54 77L50 74L51 72C54 74 58 73 57 71C55 69 54 71 52 72Z" fill="#94989b" />
        <ellipse cx="38" cy="52" rx="2.8" ry="4.4" fill="#42474b" />
        <ellipse cx="53" cy="52" rx="2.8" ry="4.4" fill="#42474b" />
      </g> : <>
      <path fill="#17212b" transform="translate(50 50) scale(1.1) translate(-50 -50)" d="M32 43Q22 30 15 34Q18 43 10 51Q19 49 20 56Q27 54 28 60L37 57ZM68 43Q78 30 85 34Q82 43 90 51Q81 49 80 56Q73 54 72 60L63 57Z" />
      <path fill="#17212b" d="M69 39C85 60 71 78 49 78C28 78 20 66 24 49C27 31 52 22 69 39Z" />
      <ellipse fill="#b63445" cx="41" cy="49" rx="3.3" ry="5.6" transform="rotate(8 41 49)" />
      <ellipse fill="#b63445" cx="57" cy="51" rx="3.3" ry="5.6" transform="rotate(8 57 51)" />
      </>}
    </svg>
    {!preview && <span ref={canvasRef} aria-hidden="true" className="contents" />}
  </span>;
}
