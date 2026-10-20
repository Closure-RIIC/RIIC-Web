"use client";

import { useEffect, useRef, type ComponentProps } from "react";

import { cn } from "./utils";

export type FluidOrbProps = ComponentProps<"div"> & {
  size?: number;
  color?: string;
  animation?: "always" | "hover";
};

// RareUI Fluid Orb shader, provided by the project owner:
// https://www.rareui.com/components/fluidorb
const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.22;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.7;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(g + (f - 0.5) * 0.8 * anchor, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 dark = u_color;

  vec3 col = white;
  col = mix(col, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, dark, smoothstep(0.58, 0.88, shade));

  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace("#", "").trim();
  if (value.length === 3) {
    value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
  }
  const parsed = Number.parseInt(value, 16);
  if (value.length !== 6 || Number.isNaN(parsed)) return [0.1, 0.45, 0.95];
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  ];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function FluidOrb({
  size = 56,
  color = "#1A73F2",
  animation = "always",
  className,
  style,
  ...props
}: FluidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const fallback = fallbackRef.current;
    const root = canvas?.parentElement;
    if (!canvas || !root) return;

    const showFallback = () => {
      if (fallback) fallback.style.opacity = "1";
      root.dataset.fluidOrbMotion = "fallback";
    };
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) {
      showFallback();
      return;
    }

    const program = gl.createProgram();
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!program || !vert || !frag) {
      if (program) gl.deleteProgram(program);
      if (vert) gl.deleteShader(vert);
      if (frag) gl.deleteShader(frag);
      showFallback();
      return;
    }

    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      showFallback();
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    const aPos = gl.getAttribLocation(program, "a_pos");
    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uColor = gl.getUniformLocation(program, "u_color");
    if (!buffer || aPos < 0 || !uResolution || !uTime || !uColor) {
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      showFallback();
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(uColor, ...hexToRgb(color));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.max(1, Math.round(size * dpr));
    canvas.width = pixels;
    canvas.height = pixels;
    gl.viewport(0, 0, pixels, pixels);
    gl.uniform2f(uResolution, pixels, pixels);
    if (fallback) fallback.style.opacity = "0";

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
    let inViewport = true;
    let hovered = root.matches(":hover") && window.matchMedia("(hover: hover)").matches;
    let frame = 0;
    let elapsed = 0;
    let previousTime: number | null = null;

    const render = (now: number) => {
      frame = 0;
      const playing = !reduceMotion && inViewport && !document.hidden && (animation === "always" || hovered);
      if (playing && previousTime !== null) elapsed += now - previousTime;
      previousTime = playing ? now : null;
      gl.uniform1f(uTime, reduceMotion ? 0 : elapsed / 1_000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      root.dataset.fluidOrbMotion = playing ? "animated" : "still";
      if (playing) {
        frame = window.requestAnimationFrame(render);
      }
    };
    const restart = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      previousTime = null;
      render(performance.now());
    };
    const observer = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? true;
      restart();
    });
    const handleMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      restart();
    };
    const handlePointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovered = true;
      restart();
    };
    const handlePointerLeave = () => {
      hovered = false;
      restart();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      showFallback();
    };

    observer.observe(root);
    motionQuery.addEventListener("change", handleMotionChange);
    document.addEventListener("visibilitychange", restart);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    if (animation === "hover") {
      root.addEventListener("pointerenter", handlePointerEnter);
      root.addEventListener("pointerleave", handlePointerLeave);
      root.addEventListener("pointercancel", handlePointerLeave);
    }
    render(performance.now());

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      motionQuery.removeEventListener("change", handleMotionChange);
      document.removeEventListener("visibilitychange", restart);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      root.removeEventListener("pointerenter", handlePointerEnter);
      root.removeEventListener("pointerleave", handlePointerLeave);
      root.removeEventListener("pointercancel", handlePointerLeave);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
  }, [color, size, animation]);

  return (
    <div
      data-slot="fluid-orb"
      data-fluid-orb-color={color}
      className={cn("relative isolate shrink-0 overflow-hidden rounded-full", className)}
      style={{ width: size, height: size, contain: "layout paint size", ...style }}
      {...props}
    >
      <span
        ref={fallbackRef}
        className="absolute inset-0 rounded-[inherit]"
        style={{
          backgroundColor: color,
          backgroundImage: `radial-gradient(circle at 32% 20%, #fbffff 0 22%, color-mix(in srgb, ${color} 42%, white) 52%, ${color} 88%)`,
        }}
        aria-hidden="true"
        data-fluid-orb-fallback
      />
      <canvas ref={canvasRef} className="relative size-full" aria-hidden="true" />
    </div>
  );
}
