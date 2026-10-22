import {
  AmbientLight, BufferGeometry, CatmullRomCurve3, Color, CubeUVReflectionMapping, DataTexture, DirectionalLight, ExtrudeGeometry, Float32BufferAttribute, Group, HalfFloatType, InstancedBufferAttribute,
  InstancedBufferGeometry, LinearFilter, LinearSRGBColorSpace, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, OrthographicCamera, RGBAFormat,
  Scene, ShaderMaterial, Shape, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createExusiaiCoat } from "./exusiai-coat";
import { createExusiaiEmbroidery } from "./exusiai-embroidery";
import { createSaileachCoat } from "./saileach-coat";
import { createMountainCoat } from "./mountain-coat";
import { DEFAULT_FUR_SETTINGS, type FurSettings } from "./fur-settings";
import { EYE_SQUINT_HEIGHT, EYE_SQUINT_WIDTH, eyeSquintInfluence, eyeSurfaceZ, furGroom } from "./fur-detail";
import { addEyeSquintMorph } from "./eye-squint";
import { createFurGpuTimer } from "./fur-gpu-timer";

// Shell fur: layered geometry, procedural strand cutouts, bent tips and soft
// directional/rim lighting. The reference uses this same rendering technique.
const VERTEX = `
attribute float aShell;
attribute vec3 aGroom;
uniform vec4 uEyes[2];
uniform float uShells;
uniform float uMess;
uniform float uGravity;
uniform float uWind;
uniform float uLength;
uniform float uTime;
uniform float uMotion;
uniform float uPress;
uniform float uGroomUp;
uniform float uCoatStyle;
uniform sampler2D uPattern;
uniform vec2 uTouch;
uniform vec2 uLag;
varying vec3 vRoot;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vSurfaceNormal;
varying vec3 vCurl;
varying float vHeight;
varying float vBaseLayer;
void main() {
  // Classify the substrate by its integer instance index. GPU reciprocal math
  // must not turn h=0 into a tiny positive value and discard painted details.
  float baseLayer = step(uShells - 1.5, aShell);
  float h = baseLayer > 0.5 ? 0.0 : 1.0 - aShell / (uShells - 1.0);
  vec3 n = normalize(normal);
  vec3 comb = aGroom;
  vec2 offset = position.xy - uTouch;
  float touch = uPress * exp(-dot(offset, offset) * 5.0);
  vec3 bend = comb * uMess + vec3(uLag.x, -0.24 * uGravity + uLag.y, 0.0);
  bend.y += uGroomUp;
  bend += vec3(sin(uTime * 1.7 + position.y * 3.0) * 0.13, 0.0, 0.0) * uMotion * uWind;
  bend.xy += offset * touch * 1.6;
  bend -= n * min(dot(bend, n), 0.0);
  float coatLength = uLength;
  if (uCoatStyle > 1.5 && uCoatStyle < 2.5 && position.z > 0.0) {
    // Use the original round ear's coverage so the inset stays white.
    float front = smoothstep(0.20, 0.68, sqrt(max(0.0, 1.0 - dot(position.xy, position.xy))));
    // White inner-ear fur is 0.48 at default settings: 3x the previous 0.16.
    coatLength *= 1.0 + 5.0 * front;
  }
  if (position.z > 0.0) {
    for (int i = 0; i < 2; i++) {
      if (uEyes[i].z > 0.0) {
        float eyeDistance = length((position.xy - uEyes[i].xy) / uEyes[i].zw);
        coatLength *= smoothstep(0.9, 1.4, eyeDistance);
      }
    }
  }
  if (uCoatStyle > 3.5 && position.z > 0.0) {
    coatLength *= texture2D(uPattern, vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5)).a;
  }
  vec3 p = position + normalize(n + bend * h) * coatLength * h * (1.0 - touch * 0.5);
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vRoot = position;
  vSurfaceNormal = n;
  vCurl = aGroom.yzx;
  vNormal = normalize(normalMatrix * normalize(n + bend * h * 0.35));
  vView = -view.xyz;
  vHeight = h;
  vBaseLayer = baseLayer;
  gl_Position = projectionMatrix * view;
}`;

const FRAGMENT = `
uniform vec4 uEmbroideredEye;
uniform vec3 uFaceColor;
uniform float uEyeSquint;
uniform vec3 uRootColor;
uniform vec3 uTipColor;
uniform float uDensity;
uniform float uThickness;
uniform float uSphericalRoots;
uniform float uCurl;
uniform float uLite;
uniform float uBrightness;
uniform float uRim;
uniform float uCoatStyle;
uniform sampler2D uPattern;
uniform vec4 uEyes[2];
varying vec3 vRoot;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vSurfaceNormal;
varying vec3 vCurl;
varying float vHeight;
varying float vBaseLayer;
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float bodyRosette(vec2 p, float seed, float hollow) {
  // Uneven lobes and an off-center opening avoid stamped circular rings.
  vec2 warped = p + vec2(sin(p.y * 3.4 + seed), cos(p.x * 4.1 - seed)) * 0.19;
  float radius = length(warped);
  float edge = max(fwidth(radius), 0.035);
  float opening = length(warped + vec2(0.20, -0.13));
  float marking = 1.0 - smoothstep(0.96 - edge, 0.96 + edge, radius);
  marking *= mix(1.0, smoothstep(0.36 - edge, 0.36 + edge, opening), hollow);
  return marking * mix(1.0, smoothstep(-0.60, -0.15, p.x + p.y * 0.8), hollow);
}
void main() {
  vec3 n = normalize(vNormal);
  float h = vHeight;
  vec4 painted = vec4(0.0);
  bool patterned = uCoatStyle > 3.5 && vRoot.z > 0.0;
  if (patterned) painted = texture2D(uPattern, vec2(vRoot.x * 0.5 + 0.5, 0.5 - vRoot.y * 0.5));
  bool smoothFace = patterned && painted.a < 0.5;
  if (smoothFace && vBaseLayer < 0.5) discard;
  float strandTone = 1.0;
  float strandDepth = h;
  if (vBaseLayer < 0.5) {
    if (vRoot.z > 0.0) {
      for (int i = 0; i < 2; i++) {
        if (uEyes[i].z > 0.0 && length((vRoot.xy - uEyes[i].xy) / uEyes[i].zw) < 1.04) discard;
      }
    }
    // Unit-sphere heads share one root field across all shells. Normalize the
    // interpolated direction so triangle interiors cannot shift the root lattice.
    // Wings, inset ears and tubes retain their authored, non-spherical surface.
    vec3 surfaceNormal = uSphericalRoots > 0.5 ? normalize(vRoot) : normalize(vSurfaceNormal);
    vec3 x = (uSphericalRoots > 0.5 ? surfaceNormal : vRoot) * uDensity;
    float aa = max(length(fwidth(x)) * 0.5, 0.015);
    x += (vCurl - surfaceNormal * dot(vCurl, surfaceNormal)) * h * h * uCurl;
    vec3 cell = floor(x - 0.5);
    float coverage = 0.0;
    for (int z = 0; z < 2; z++) {
      for (int y = 0; y < 2; y++) {
        for (int i = 0; i < 2; i++) {
          vec3 c = cell + vec3(float(i), float(y), float(z));
          vec3 root = c + hash33(c);
          float rootCoverage = 1.0;
          if (uSphericalRoots > 0.5) {
            float radiusSquared = dot(root, root);
            if (radiusSquared < (uDensity - 0.5) * (uDensity - 0.5) || radiusSquared > (uDensity + 0.5) * (uDensity + 0.5)) continue;
            float rootRadius = sqrt(radiusSquared);
            root *= uDensity / max(rootRadius, 0.001);
          } else {
            float depthOffset = dot(x - root, surfaceNormal);
            rootCoverage = 1.0 - smoothstep(0.45, 0.7, abs(depthOffset));
          }
          // These candidates contribute exactly zero coverage. Reject them
          // before evaluating strand lean, radius and distance on every shell.
          if (rootCoverage <= 0.0) continue;
          vec3 random = hash33(c + 71.3);
          float strandHeight = mix(0.5, 1.0, random.z);
          if (h > strandHeight) continue;
          float tip = clamp(h / strandHeight, 0.0, 1.0);
          vec3 delta = x - root;
          // Lite coats keep the same roots, strand heights and shell silhouette.
          // Only the extra random per-strand lean is omitted: one less hash and
          // tangent projection for each surviving candidate on every shell.
          if (uLite < 0.5) {
            vec3 lean = hash33(c + 23.7) - 0.5;
            delta -= (lean - surfaceNormal * dot(lean, surfaceNormal)) * tip * tip * 0.65;
          }
          float radius = 0.38 * uThickness * mix(0.8, 1.0, random.x) * (1.0 - 0.72 * tip * tip);
          float distanceToStrand = length(delta - surfaceNormal * dot(delta, surfaceNormal));
          float strand = (1.0 - smoothstep(radius - aa, radius + aa, distanceToStrand)) * step(h, strandHeight) * rootCoverage;
          if (strand > coverage) { coverage = strand; strandTone = 0.88 + random.y * 0.24; strandDepth = tip; }
        }
      }
    }
    if (coverage < mix(0.25, 0.7, hash33(vec3(gl_FragCoord.xy, h * 271.0)).x)) discard;
  }
  vec3 light = normalize(vec3(-0.45, 0.8, 1.0));
  float diffuse = pow(clamp((dot(n, light) + 0.6) / 1.6, 0.0, 1.0), 1.5);
  float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
  vec3 rootColor = uRootColor;
  vec3 tipColor = uTipColor;
  if (uCoatStyle > 0.5 && uCoatStyle < 1.5) {
    // Silver-gray crown fades into a snow-white lower face.
    float crown = smoothstep(-0.55, 0.85, vRoot.y);
    rootColor = mix(vec3(0.70), vec3(0.38), crown);
    tipColor = mix(vec3(0.96), vec3(0.74), crown);
    // Four asymmetric patches, with different silhouettes and generous gaps.
    vec2 p = vRoot.xy;
    float spots = bodyRosette((p - vec2(-0.68, 0.34)) / vec2(0.27, 0.21), 0.7, 1.0);
    spots = max(spots, bodyRosette((p - vec2(0.77, 0.04)) / vec2(-0.19, 0.30), 2.4, 0.0));
    spots = max(spots, bodyRosette((p - vec2(-0.57, -0.52)) / vec2(0.29, -0.24), 4.1, 0.0));
    spots = max(spots, bodyRosette((p - vec2(0.35, -0.69)) / vec2(-0.31, 0.23), 5.8, 1.0));
    rootColor = mix(rootColor, vec3(0.19), spots);
    tipColor = mix(tipColor, vec3(0.43), spots);
  } else if (uCoatStyle > 1.5 && uCoatStyle < 2.5) {
    // Rounded ears: white front, dark upper back fading to pale gray below.
    float top = smoothstep(-0.75, 0.85, vRoot.y);
    float front = vRoot.z > 0.0 ? smoothstep(0.20, 0.68, sqrt(max(0.0, 1.0 - dot(vRoot.xy, vRoot.xy)))) : 0.0;
    rootColor = mix(mix(vec3(0.48), vec3(0.065), top), vec3(0.78), front);
    tipColor = mix(mix(vec3(0.76), vec3(0.19), top), vec3(0.98), front);
  } else if (uCoatStyle > 2.5 && uCoatStyle < 3.5) {
    // A few broad, broken rosettes read at avatar size without noisy speckles.
    vec2 p = vec2(vRoot.x * 8.0 + vRoot.y * 2.0, vRoot.y * 7.0 + vRoot.z * 2.5);
    p += sin(p.yx * 1.7) * 0.18;
    vec2 cell = floor(p);
    vec3 variation = hash33(vec3(cell, 4.7));
    vec2 q = fract(p) - 0.5 - (variation.xy - 0.5) * 0.16;
    q.x *= mix(0.75, 1.15, variation.z);
    q.y += sin(q.x * 8.0 + variation.x * 6.0) * 0.065;
    float radius = length(q);
    float edge = max(fwidth(radius), 0.018);
    float ring = smoothstep(0.16 - edge, 0.16 + edge, radius)
      * (1.0 - smoothstep(0.33 - edge, 0.33 + edge, radius));
    ring *= smoothstep(-0.22, -0.05, q.x + q.y * sin(cell.x + cell.y));
    rootColor = mix(vec3(0.58), vec3(0.12), ring);
    tipColor = mix(vec3(0.91), vec3(0.32), ring);
  } else if (patterned) {
    rootColor = painted.rgb * 0.55;
    tipColor = painted.rgb;
  }
  float depth = mix(h, strandDepth, 0.3);
  vec3 sheen = mix(tipColor, vec3(1.0), 0.22);
  vec3 softTip = mix(tipColor, sheen, smoothstep(0.7, 1.0, depth) * 0.3);
  float sky = mix(0.78, 1.0, n.y * 0.5 + 0.5);
  vec3 color = mix(rootColor, softTip, depth) * strandTone * (0.65 * uBrightness * sky + diffuse * 0.85) * mix(0.7, 1.0, depth);
  color += sheen * rim * smoothstep(0.2, 1.0, depth) * 0.4 * uRim;
  if (smoothFace) {
    vec3 view = normalize(vView);
    vec3 halfway = normalize(light + view);
    float highlight = max(dot(n, halfway), 0.0);
    // Fade the static eye backing into the face as the real lens and stitches
    // close, so their original round silhouette cannot show through.
    if (uEmbroideredEye.z > 0.0 && length((vRoot.xy - uEmbroideredEye.xy) / uEmbroideredEye.zw) < 1.10) {
      painted.rgb = mix(painted.rgb, uFaceColor, smoothstep(0.0, 0.08, uEyeSquint));
      painted.a *= 1.0 - smoothstep(0.0, 0.08, uEyeSquint);
    }
    // The alpha channel labels surface treatments below 0.5; fur remains 1.
    // Details are shaded on the original curved substrate, not floating decals.
    bool headband = uCoatStyle > 4.5 && uCoatStyle < 5.5;
    vec2 weaveUV = vRoot.xy * (headband ? 600.0 : 850.0);
    vec2 filtering = 1.0 - smoothstep(vec2(0.7), vec2(2.0), fwidth(weaveUV));
    float weave = (sin(weaveUV.x) * filtering.x + sin(weaveUV.y) * filtering.y) * 0.025;
    if (headband && painted.a > 0.34) {
      // Warm satin metal: broad gold reflection with a small polished glint.
      color = painted.rgb * (0.70 + diffuse * 0.35);
      color += mix(painted.rgb, vec3(1.0), 0.35) * pow(highlight, 28.0) * 0.40;
    } else if (headband && painted.a > 0.16) {
      // Dyed woven ribbon, with the existing diamond embroidery left intact.
      color = painted.rgb * (0.80 + diffuse * 0.28 + weave);
      color += painted.rgb * rim * 0.12;
    } else if (uCoatStyle > 3.5 && uCoatStyle < 4.5 && painted.a > 0.16) {
      // Matte backing beneath actual raised thread geometry and short fibers.
      color = painted.rgb * (0.84 + diffuse * 0.20);
    } else {
      // Soft matte face applique; embroidery has its own directional response.
      color = painted.rgb * (0.85 + diffuse * 0.20 + weave * 0.5);
      color += painted.rgb * pow(highlight, 8.0) * 0.025;
    }
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

export type FurAvatarPose = {
  inertiaX?: number;
  yaw: number; pitch: number; press: number; time: number; active: boolean;
  lagX: number; lagY: number;
};
export type FurAvatarVariant = "closure" | "silverash" | "exusiai" | "saileach" | "mountain";
export type FurRenderQuality = "full" | "lite";

let environmentPixels: Promise<Uint16Array> | undefined;
function loadEnvironment() {
  return environmentPixels ??= (async () => {
    // The exact RoomEnvironment PMREM, generated by bake-plush-environment.mjs.
    // A fixed reflection map does not need hundreds of GPU passes per page load.
    const response = await fetch("/textures/plush-room-environment.bin.gz");
    if (!response.ok) throw new Error("Plush environment unavailable");
    const blob = await response.blob();
    const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const bytes = header[0] === 0x1f && header[1] === 0x8b
      ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      : await blob.arrayBuffer();
    if (bytes.byteLength !== 768 * 1024 * 4 * 2) throw new Error("Invalid plush environment");
    return new Uint16Array(bytes);
  })().catch(error => { environmentPixels = undefined; throw error; });
}

function buildRenderer(environmentData: Uint16Array, canvas?: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: canvas ? "high-performance" : "low-power" });
  let disposed = false;
  let submitted: WebGLSync | null = null;
  let submittedAt = 0, frameMs = 1000 / 60, fencePolled = false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let gpuTimer = createFurGpuTimer(gl);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const device = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
  // A visible software-WebGL canvas can stall the browser compositor itself.
  // Keep its expensive draw offscreen and yield until ready, as chat does.
  const software = /SwiftShader|llvmpipe|Software|Microsoft Basic Render/i.test(device);
  const direct = Boolean(canvas) && !software;
  // Adaptive sampling must not resize/clear the visible drawing buffer. Render
  // into one reusable GPU target, then present the complete image in one pass.
  const presentationTarget = direct ? new WebGLRenderTarget(1, 1, {
    colorSpace: SRGBColorSpace,
    samples: Math.min(gl.getParameter(gl.SAMPLES) as number, renderer.capabilities.maxSamples),
    minFilter: LinearFilter, magFilter: LinearFilter,
  }) : null;
  const outputPass = direct ? new OutputPass() : null;
  if (outputPass) outputPass.renderToScreen = true;
  let surfaceWidth = 0, surfaceHeight = 0;
  let pendingDraw: Promise<unknown> = Promise.resolve();
  const compiledVariants = new Set<FurAvatarVariant>();
  // A software canvas copy can freeze input for seconds. Fence its submitted
  // frame and yield until ready; hardware copies use the ordered GPU queue.
  const waitForGpu = async () => {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) return false;
    gl.flush();
    const deadline = performance.now() + 30_000;
    try {
      while (!disposed && !gl.isContextLost()) {
        const state = gl.clientWaitSync(fence, 0, 0);
        if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) return true;
        if (state === gl.WAIT_FAILED || performance.now() > deadline) return false;
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      return false;
    } finally { gl.deleteSync(fence); }
  };
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const environment = new DataTexture(environmentData, 768, 1024, RGBAFormat, HalfFloatType);
  environment.mapping = CubeUVReflectionMapping;
  environment.colorSpace = LinearSRGBColorSpace;
  environment.minFilter = environment.magFilter = LinearFilter;
  environment.needsUpdate = true;
  scene.environment = environment;
  const keyLight = new DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-2, 4, 5);
  scene.add(keyLight, new AmbientLight(0xffffff, 0.35));
  const camera = new OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 20);
  camera.position.set(0, 0, 5);
  const rig = new Group();
  scene.add(rig);
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<ShaderMaterial | MeshBasicMaterial | MeshPhysicalMaterial | LineBasicMaterial>();
  const coats: ShaderMaterial[] = [];
  const coatSettings = new Map<ShaderMaterial, { mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>; geometry: InstancedBufferGeometry; liteGeometry: InstancedBufferGeometry; length: number; density: number }>();
  const textures: ReturnType<typeof createExusiaiCoat>[] = [];
  const sphere = new SphereGeometry(1, 48, 36);
  // About 55% fewer sphere vertices. Accessories with authored silhouettes are
  // untouched; small portraits cannot resolve the original head tessellation.
  const liteSphere = new SphereGeometry(1, 32, 24);
  geometries.add(sphere);
  geometries.add(liteSphere);

  const shellGeometry = (base: BufferGeometry) => {
    const geometry = new InstancedBufferGeometry();
    geometry.index = base.index;
    for (const [name, attribute] of Object.entries(base.attributes)) geometry.setAttribute(name, attribute);
    if (!base.hasAttribute("aGroom")) {
      const positions = base.getAttribute("position");
      const grooming = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) grooming.set(furGroom(positions.getX(i), positions.getY(i), positions.getZ(i)), i * 3);
      base.setAttribute("aGroom", new Float32BufferAttribute(grooming, 3));
    }
    geometry.setAttribute("aGroom", base.getAttribute("aGroom"));
    // Allocate once; changing quality only changes the instance count/uniforms.
    geometry.setAttribute("aShell", new InstancedBufferAttribute(Float32Array.from({ length: 64 }, (_, i) => i), 1));
    geometry.instanceCount = DEFAULT_FUR_SETTINGS.shells;
    geometries.add(geometry);
    return geometry;
  };
  const fur = (base: BufferGeometry, length: number, density: number, coatStyle = 0, colors = ["#131d28", "#354654"], groomUp = 0) => {
    const geometry = shellGeometry(base);
    const liteGeometry = base === sphere ? shellGeometry(liteSphere) : geometry;
    const material = new ShaderMaterial({
      // All coats use closed outward-facing meshes; their interior faces never
      // contribute to the silhouette and need not shade the strand field.
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: {
        uEyes: { value: [new Vector4(), new Vector4()] },
        uEmbroideredEye: { value: new Vector4() }, uFaceColor: { value: new Color("#f1d4ac") }, uEyeSquint: { value: 0 },
        uShells: { value: DEFAULT_FUR_SETTINGS.shells }, uMess: { value: 1 },
        uGravity: { value: 1 }, uWind: { value: 1 }, uThickness: { value: 1 },
        uCurl: { value: 1 }, uLite: { value: 0 }, uBrightness: { value: 1 }, uRim: { value: 1 },
        uLength: { value: length }, uTime: { value: 0 }, uMotion: { value: 0 },
        uPress: { value: 0 }, uTouch: { value: new Vector2() }, uLag: { value: new Vector2() },
        uRootColor: { value: new Color(colors[0]) }, uTipColor: { value: new Color(colors[1]) },
        uDensity: { value: density * 2.6 }, uCoatStyle: { value: coatStyle },
        uSphericalRoots: { value: base === sphere ? 1 : 0 },
        uGroomUp: { value: groomUp },
        uPattern: { value: null },
      },
    });
    coats.push(material);
    materials.add(material);
    const mesh = new Mesh(geometry, material);
    coatSettings.set(material, { mesh, geometry, liteGeometry, length, density: density * 2.6 });
    mesh.frustumCulled = false;
    return mesh;
  };

  const eyeMasks = new Map<Mesh, { mask: Vector4; rest: Vector4 }>();
  const addEyes = (parent: Group, head: Mesh<InstancedBufferGeometry, ShaderMaterial>, specs: { x: number; y: number; rx: number; ry: number; color: string; rimColor?: string }[]) => {
    const center = head.position.toArray(), radii = head.scale.toArray();
    return specs.map((spec, eyeIndex) => {
      const { x, y, rx, ry } = spec;
      const rimWidth = spec.rimColor ? 0.005 : 0;
      head.material.uniforms.uEyes.value[eyeIndex].set((x - center[0]) / radii[0], (y - center[1]) / radii[1], (rx + rimWidth) / radii[0], (ry + rimWidth) / radii[1]);
      const geometry = new BufferGeometry();
      const positions: number[] = [], indices: number[] = [];
      const centerZ = eyeSurfaceZ(x, y, center, radii);
      const rings = 10, sides = 48;
      for (let ring = 0; ring <= rings; ring++) {
        const r = ring / rings;
        for (let side = 0; side <= sides; side++) {
          const angle = side / sides * Math.PI * 2;
          const dx = Math.cos(angle) * rx * r, dy = Math.sin(angle) * ry * r;
          // A shallow polished lens follows the sphere; no floating face plates.
          positions.push(dx, dy, eyeSurfaceZ(x + dx, y + dy, center, radii) - centerZ + 0.004 + 0.035 * (1 - r * r));
          if (ring < rings && side < sides) {
            const a = ring * (sides + 1) + side, b = a + sides + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
      }
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      addEyeSquintMorph(geometry, [x, y], center, radii, [x, y, centerZ]);
      geometries.add(geometry);
      const material = new MeshPhysicalMaterial({ color: spec.color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, metalness: 0, envMapIntensity: 0.9 });
      materials.add(material);
      const eye = new Mesh(geometry, material);
      eye.position.set(x, y, centerZ);
      const mask = head.material.uniforms.uEyes.value[eyeIndex] as Vector4;
      eyeMasks.set(eye, { mask, rest: mask.clone() });
      if (spec.rimColor) {
        const rimGeometry = new BufferGeometry();
        const rimPositions: number[] = [], rimIndices: number[] = [];
        for (let ring = 0; ring <= 1; ring++) for (let side = 0; side <= sides; side++) {
          const angle = side / sides * Math.PI * 2;
          const dx = Math.cos(angle) * (ring ? rx + rimWidth : rx * 0.98);
          const dy = Math.sin(angle) * (ring ? ry + rimWidth : ry * 0.98);
          rimPositions.push(dx, dy, eyeSurfaceZ(x + dx, y + dy, center, radii) - centerZ + 0.003);
          if (!ring && side < sides) {
            const next = side + sides + 1;
            rimIndices.push(side, next, side + 1, side + 1, next, next + 1);
          }
        }
        rimGeometry.setAttribute("position", new Float32BufferAttribute(rimPositions, 3));
        rimGeometry.setIndex(rimIndices);
        rimGeometry.computeVertexNormals();
        addEyeSquintMorph(rimGeometry, [x, y], center, radii, [x, y, centerZ]);
        const rimMaterial = new MeshPhysicalMaterial({ color: spec.rimColor, roughness: 0.85 });
        geometries.add(rimGeometry);
        materials.add(rimMaterial);
        eye.add(new Mesh(rimGeometry, rimMaterial));
      }
      parent.add(eye);
      return eye;
    });
  };

  const body = fur(sphere, 0.12, 40);
  body.scale.set(0.74, 0.7, 0.62);
  body.position.set(-0.03, -0.05, 0);
  rig.add(body);

  // Rounded scallop tips and aligned tangents keep the fur flowing across joins.
  const outline = new Shape();
  outline.moveTo(0, 0.16);
  outline.bezierCurveTo(0.2, 0.29, 0.45, 0.60, 0.65, 0.58);
  outline.bezierCurveTo(0.73, 0.572, 0.68, 0.47, 0.65, 0.40);
  outline.bezierCurveTo(0.59, 0.26, 0.71, 0.10, 0.84, -0.005);
  outline.bezierCurveTo(0.94, -0.086, 0.78, -0.008, 0.68, -0.045);
  outline.bezierCurveTo(0.59, -0.078, 0.615, -0.17, 0.58, -0.205);
  outline.bezierCurveTo(0.545, -0.240, 0.50, -0.16, 0.41, -0.175);
  outline.bezierCurveTo(0.32, -0.19, 0.30, -0.255, 0.27, -0.30);
  outline.bezierCurveTo(0.24, -0.345, 0.22, -0.28, 0.14, -0.27);
  outline.bezierCurveTo(0.07, -0.261, 0, -0.28, 0, -0.32);
  outline.closePath();
  const extrusion = new ExtrudeGeometry(outline, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.022, bevelSegments: 5, steps: 1, curveSegments: 16 });
  // ExtrudeGeometry splits vertices per face. Weld before recalculating normals
  // so adjacent fur shells do not fan apart at the bevel/face seams.
  // This procedural coat does not use UVs; removing them allows seam welding.
  extrusion.deleteAttribute("normal");
  extrusion.deleteAttribute("uv");
  const wingGeometry = mergeVertices(extrusion, 1e-5);
  extrusion.dispose();
  wingGeometry.computeVertexNormals();
  wingGeometry.translate(0, 0, -0.045);
  geometries.add(wingGeometry);
  const wings = [-1, 1].map((side) => {
    const pivot = new Group();
    pivot.position.set(side * 0.43, -0.03, -0.13);
    const wing = fur(wingGeometry, 0.065, 55);
    wing.scale.set(side * 0.9, 0.9, 0.9);
    pivot.add(wing);
    rig.add(pivot);
    return pivot;
  });

  const eyes = addEyes(rig, body, [[-0.27, 0.08], [0.22, 0.04]].map(([x, y]) => ({ x, y, rx: 0.09, ry: 0.16, color: "#b63445" })));

  // Build additional characters only when selected. All rigs share one WebGL
  // context and the base sphere; only the selected rig is submitted for drawing.
  const closureCoats = [...coats];
  const buildSilverash = () => {
    const firstCoat = coats.length;
    const silverRig = new Group();
    scene.add(silverRig);
    const head = fur(sphere, 0.11, 42, 1);
    head.scale.set(0.67, 0.62, 0.56);
    head.position.set(-0.11, -0.12, 0);
    silverRig.add(head);

    // Open at the front: a raised charcoal half-collar sits behind the cheeks.
    // Uneven heights and thickness avoid a rigid ring; longer fur is groomed up.
    const ruffCurve = new CatmullRomCurve3([
      new Vector3(-0.65, 0, 0.12), new Vector3(-0.72, 0.08, -0.12),
      new Vector3(-0.52, 0.13, -0.39), new Vector3(-0.20, 0.21, -0.49),
      new Vector3(0.17, 0.17, -0.51), new Vector3(0.48, 0.15, -0.38),
      new Vector3(0.70, 0.09, -0.10), new Vector3(0.64, 0.02, 0.14),
    ]);
    const ruffGeometry = new TubeGeometry(ruffCurve, 48, 0.095, 10, false);
    // Vary the thickness as well as the outline, using one mesh for the collar.
    const ruffPositions = ruffGeometry.getAttribute("position");
    for (let segment = 0; segment <= 48; segment++) {
      const t = segment / 48;
      const center = ruffCurve.getPointAt(t);
      const taper = Math.min(1, 0.18 + Math.sin(t * Math.PI) * 3);
      const thickness = taper * (1 + Math.sin(t * Math.PI * 6 + 0.7) * 0.19
        + Math.sin(t * Math.PI * 14 - 0.4) * 0.11);
      for (let side = 0; side <= 10; side++) {
        const index = segment * 11 + side;
        ruffPositions.setXYZ(index,
          center.x + (ruffPositions.getX(index) - center.x) * thickness,
          center.y + (ruffPositions.getY(index) - center.y) * thickness,
          center.z + (ruffPositions.getZ(index) - center.z) * thickness);
      }
    }
    ruffGeometry.computeVertexNormals();
    geometries.add(ruffGeometry);
    const ruff = fur(ruffGeometry, 0.20, 44, 0, ["#303030", "#686868"], 3.2);
    ruff.position.set(-0.11, -0.38, 0);
    silverRig.add(ruff);

    // A deeper, smooth bowl in the white front, with the rounded rim intact.
    // Share the inset mesh across both ears; build it only once per character.
    const earGeometry = sphere.clone();
    earGeometry.deleteAttribute("aGroom");
    const earPositions = earGeometry.getAttribute("position");
    for (let i = 0; i < earPositions.count; i++) {
      const x = earPositions.getX(i), y = earPositions.getY(i), z = earPositions.getZ(i);
      if (z <= 0) continue;
      const inset = Math.max(0, 1 - (x * x + y * y) / (0.85 * 0.85));
      earPositions.setZ(i, z - 0.72 * inset * inset);
    }
    earGeometry.computeVertexNormals();
    geometries.add(earGeometry);
    const ears = [-1, 1].map(side => {
      const pivot = new Group();
      pivot.position.set(-0.11 + side * 0.43, 0.42, -0.015);
      pivot.rotation.z = -side * 0.17;
      const ear = fur(earGeometry, 0.08, 48, 2);
      ear.scale.set(0.25, 0.27, 0.16);
      pivot.add(ear);
      silverRig.add(pivot);
      return pivot;
    });

    const tail = new Group();
    tail.position.set(0.25, -0.41, -0.43);
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0, 0), new Vector3(0.38, -0.08, -0.14),
      new Vector3(0.66, 0.14, -0.25), new Vector3(0.61, 0.46, -0.34),
      new Vector3(0.44, 0.54, -0.39), new Vector3(0.35, 0.43, -0.40),
    ]);
    const tailGeometry = new TubeGeometry(curve, 32, 0.105, 12, false);
    geometries.add(tailGeometry);
    tail.add(fur(tailGeometry, 0.058, 56, 3));
    const tip = fur(sphere, 0.055, 48, 0, ["#8a8d90", "#d3d5d6"]);
    tip.scale.setScalar(0.108);
    tip.position.copy(curve.getPoint(1));
    tail.add(tip);
    silverRig.add(tail);

    const silverEyes = addEyes(silverRig, head, [-0.32, 0.09].map(x => ({ x, y: -0.07, rx: 0.075, ry: 0.115, color: "#42474b" })));
    return { rig: silverRig, ears, tail, eyes: silverEyes, coats: coats.slice(firstCoat) };
  };
  let silverash: ReturnType<typeof buildSilverash> | undefined;
  const buildExusiai = () => {
    const firstCoat = coats.length;
    const angelRig = new Group();
    scene.add(angelRig);
    const coat = createExusiaiCoat();
    textures.push(coat);
    const head = fur(sphere, 0.10, 42, 4, ["#b8222e", "#ff3b42"]);
    head.material.uniforms.uPattern.value = coat;
    head.scale.set(0.74, 0.70, 0.74);
    head.position.set(0, -0.13, 0);
    angelRig.add(head);

    // Keep the vertex-color gradients under the same polished finish as the eyes.
    const accessoryMaterial = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, metalness: 0, envMapIntensity: 0.9 });
    materials.add(accessoryMaterial);
    const paintAccessory = (geometry: BufferGeometry, axis: "y" | "z") => {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const extent = Math.max(bounds.max[axis] - bounds.min[axis], 0.001);
      const positions = geometry.getAttribute("position");
      const colors = new Float32Array(positions.count * 3);
      const yellow = new Color("#ffe000");
      const gradientEnd = new Color(axis === "z" ? "#fff2a8" : "#ffe875");
      const color = new Color();
      for (let i = 0; i < positions.count; i++) {
        const coordinate = axis === "z" ? positions.getZ(i) : positions.getY(i);
        const t = (coordinate - bounds.min[axis]) / extent;
        // Keep the halo's pale rear visible at its sides when the head occludes it.
        const fade = axis === "z"
          ? Math.max(0, Math.min(1, (1 - t - 0.22) / 0.33))
          : Math.min(1, (1 - t) * 1.15);
        color.copy(yellow).lerp(gradientEnd, fade);
        color.toArray(colors, i * 3);
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    };
    // Detached diamonds leave a clear gap beside the plush body.
    const feather = new Shape();
    feather.moveTo(0, 0.115);
    feather.lineTo(0.075, 0);
    feather.lineTo(0, -0.115);
    feather.lineTo(-0.075, 0);
    feather.closePath();
    const featherGeometry = new ExtrudeGeometry(feather, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, steps: 1 });
    geometries.add(featherGeometry);
    paintAccessory(featherGeometry, "y");
    const angelWings = [-1, 1].map(side => {
      const pivot = new Group();
      pivot.position.set(side * 1.05, -0.10, -0.12);
      for (let i = 0; i < 3; i++) {
        const diamond = new Mesh(featherGeometry, accessoryMaterial);
        diamond.position.set(side * (i === 1 ? 0.025 : 0), (1 - i) * 0.28, 0);
        diamond.rotation.z = -side * (0.25 + i * 0.25);
        pivot.add(diamond);
      }
      angelRig.add(pivot);
      return pivot;
    });

    const haloCurve = new CatmullRomCurve3(Array.from({ length: 16 }, (_, i) => {
      const angle = i * Math.PI / 8;
      // A real circular ring, tilted behind the crown as in the supplied drawing.
      return new Vector3(Math.cos(angle) * 0.62, Math.sin(angle) * 0.62 * 0.55, Math.sin(angle) * 0.62 * Math.sqrt(1 - 0.55 ** 2));
    }), true);
    const haloGeometry = new TubeGeometry(haloCurve, 48, 0.085, 16, true);
    geometries.add(haloGeometry);
    paintAccessory(haloGeometry, "z");
    // Soften the ring's rim reflections without changing the glossy wings.
    const haloMaterial = accessoryMaterial.clone();
    haloMaterial.envMapIntensity = 0.55;
    haloMaterial.clearcoatRoughness = 0.18;
    haloMaterial.emissive.set("#fff2b3");
    haloMaterial.emissiveIntensity = 0.10;
    materials.add(haloMaterial);
    const halo = new Mesh(haloGeometry, haloMaterial);
    halo.position.set(0.02, 0.70, -0.25);
    halo.rotation.z = 0;
    angelRig.add(halo);

    const angelEyes = addEyes(angelRig, head, [{ x: -0.25, y: -0.025, rx: 0.105, ry: 0.14, color: "#ffe02b" }]);
    head.material.uniforms.uEmbroideredEye.value.copy(head.material.uniforms.uEyes.value[0]);
    const embroidery = createExusiaiEmbroidery(coat);
    embroidery.traverse(object => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        geometries.add(object.geometry);
        materials.add(object.material);
      }
    });
    angelRig.add(embroidery);
    return { rig: angelRig, wings: angelWings, halo, accessoryMaterial, embroidery, eyes: angelEyes, coats: coats.slice(firstCoat) };
  };
  let exusiai: ReturnType<typeof buildExusiai> | undefined;
  const buildSaileach = () => {
    const firstCoat = coats.length;
    const willowRig = new Group();
    scene.add(willowRig);
    const coat = createSaileachCoat();
    textures.push(coat);
    const head = fur(sphere, 0.10, 42, 5, ["#b79a58", "#f4d68b"]);
    head.material.uniforms.uPattern.value = coat;
    head.scale.set(0.72, 0.70, 0.72);
    head.position.set(0, -0.08, 0);
    willowRig.add(head);

    // Roots start behind the head (-Z), sweep along its sides and point forward (+Z).
    const hornCurve = new CatmullRomCurve3([
      new Vector3(0.48, 0.08, -0.48), new Vector3(0.65, 0.23, -0.30),
      new Vector3(0.64, 0.35, -0.02), new Vector3(0.53, 0.40, 0.29),
      new Vector3(0.36, 0.35, 0.55),
    ]);
    const hornSegments = 72, hornSides = 12;
    const hornGeometry = new TubeGeometry(hornCurve, hornSegments, 1, hornSides, false);
    geometries.add(hornGeometry);
    const positions = hornGeometry.getAttribute("position");
    const hornColors = new Float32Array(positions.count * 3);
    const root = new Color("#51647f"), tip = new Color("#e1dfcd"), color = new Color();
    const direction = new Vector3(), vertex = new Vector3();
    for (let ring = 0; ring <= hornSegments; ring++) {
      const t = ring / hornSegments, center = hornCurve.getPointAt(t);
      // Five broad growth ridges are part of the volume, so they remain visible in profile.
      const phase = (t * 5.5) % 1;
      const ridge = Math.sin(Math.PI * phase) ** 4;
      const radius = 0.115 * (1 - t) ** 0.72 * (1 + ridge * 0.18);
      for (let side = 0; side <= hornSides; side++) {
        const i = ring * (hornSides + 1) + side;
        direction.fromBufferAttribute(positions, i).sub(center).normalize();
        vertex.copy(center).addScaledVector(direction, radius);
        positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
        color.copy(root).lerp(tip, t).multiplyScalar(0.78 + ridge * 0.18 + Math.max(0, direction.z) * 0.12);
        color.toArray(hornColors, i * 3);
      }
    }
    hornGeometry.computeVertexNormals();
    hornGeometry.computeBoundingSphere();
    hornGeometry.setAttribute("color", new Float32BufferAttribute(hornColors, 3));
    const hornMaterial = new MeshBasicMaterial({ vertexColors: true });
    materials.add(hornMaterial);
    for (const side of [-1, 1]) {
      const horn = new Mesh(hornGeometry, hornMaterial);
      horn.scale.set(side, 1, 1);
      willowRig.add(horn);
    }

    const braid = new Group();
    braid.position.set(0.56, -0.13, 0.21);
    const braidCurve = new CatmullRomCurve3([
      new Vector3(0, 0, 0), new Vector3(0.06, -0.13, 0.01),
      new Vector3(0, -0.27, 0.02), new Vector3(0.07, -0.40, 0.01),
      new Vector3(0.015, -0.54, 0),
    ]);
    const braidGeometry = new TubeGeometry(braidCurve, 24, 0.10, 8, false);
    geometries.add(braidGeometry);
    braid.add(fur(braidGeometry, 0.025, 52, 0, ["#b99951", "#f4d68b"]));
    const ribbonMaterial = new MeshBasicMaterial({ color: "#304768" });
    materials.add(ribbonMaterial);
    const tie = new Mesh(sphere, ribbonMaterial);
    tie.scale.set(0.12, 0.055, 0.105);
    tie.position.copy(braidCurve.getPoint(0.9));
    braid.add(tie);
    willowRig.add(braid);
    const willowEyes = addEyes(willowRig, head, [-0.22, 0.22].map(x => ({ x, y: -0.112, rx: 0.087, ry: 0.124, color: "#97c9f2", rimColor: "#526481" })));
    return { rig: willowRig, braid, eyes: willowEyes, coats: coats.slice(firstCoat) };
  };
  let saileach: ReturnType<typeof buildSaileach> | undefined;
  const buildMountain = () => {
    const firstCoat = coats.length;
    const tigerRig = new Group();
    scene.add(tigerRig);
    const coat = createMountainCoat();
    textures.push(coat);
    const head = fur(sphere, 0.105, 42, 4, ["#aeb0b0", "#f0f0ed"]);
    head.material.uniforms.uPattern.value = coat;
    head.scale.set(0.74, 0.71, 0.74);
    head.position.set(0, -0.10, 0);
    tigerRig.add(head);
    // Small rounded black ears with white inner tufts; no human face or floating muzzle.
    const ears = [-1, 1].map(side => {
      const pivot = new Group();
      pivot.position.set(side * 0.49, 0.49, -0.06);
      pivot.rotation.z = -side * 0.18;
      const ear = fur(sphere, 0.065, 46, 0, ["#232629", "#45494d"]);
      ear.scale.set(0.225, 0.23, 0.16);
      pivot.add(ear);
      const inner = fur(sphere, 0.04, 48, 0, ["#b8baba", "#f0f0ed"]);
      inner.scale.set(0.14, 0.15, 0.095);
      inner.position.set(0, -0.005, 0.11);
      pivot.add(inner);
      tigerRig.add(pivot);
      return pivot;
    });
    // A compact ringed tail curls behind the body. Six contiguous furry pieces
    // keep the bands around its full circumference without a new shader variant.
    const tail = new Group();
    tail.position.set(0.35, -0.42, -0.40);
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0, 0), new Vector3(0.30, -0.06, -0.07),
      new Vector3(0.53, 0.10, -0.08), new Vector3(0.51, 0.36, -0.10),
      new Vector3(0.36, 0.46, -0.08),
    ]);
    for (let band = 0; band < 6; band++) {
      const part = new CatmullRomCurve3(Array.from({ length: 7 }, (_, i) => curve.getPoint((band + i / 6) / 6)));
      const geometry = new TubeGeometry(part, 8, 0.09, 10, false);
      geometries.add(geometry);
      tail.add(fur(geometry, 0.04, 48, 0, band % 2 ? ["#25282b", "#484c50"] : ["#aeb0b0", "#f0f0ed"]));
    }
    const tailTip = fur(sphere, 0.04, 48, 0, ["#25282b", "#484c50"]);
    tailTip.scale.setScalar(0.09);
    tailTip.position.copy(curve.getPoint(1));
    tail.add(tailTip);
    tigerRig.add(tail);
    const tigerEyes = addEyes(tigerRig, head, [-0.23, 0.23].map(x => ({ x, y: -0.085, rx: 0.084, ry: 0.107, color: "#78aabd" })));
    return { rig: tigerRig, ears, tail, eyes: tigerEyes, coats: coats.slice(firstCoat) };
  };
  let mountain: ReturnType<typeof buildMountain> | undefined;
  let lost = false;
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; gpuTimer.dispose(); };
  const contextRestored = () => {
    lost = false; submitted = null; compiledVariants.clear();
    gpuTimer = createFurGpuTimer(gl);
    renderer.domElement.dispatchEvent(new Event("fur-context-restored", { bubbles: true }));
  };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  let size = 0, width = 0;
  const variantRig = (variant: FurAvatarVariant) => variant === "silverash" ? (silverash ??= buildSilverash()).rig
    : variant === "exusiai" ? (exusiai ??= buildExusiai()).rig
    : variant === "saileach" ? (saileach ??= buildSaileach()).rig
    : variant === "mountain" ? (mountain ??= buildMountain()).rig : rig;
  return {
    direct,
    software,
    gpuMs: () => gpuTimer.milliseconds(),
    frameMs: () => frameMs,
    // Backpressure without waiting: never queue more than one GPU frame. RAF
    // continues handling input while slow/software GPUs finish the previous one.
    ready() {
      if (!submitted || lost) return true;
      const state = gl.clientWaitSync(submitted, 0, 0);
      if (state === gl.TIMEOUT_EXPIRED) { fencePolled = true; return false; }
      // Ignore a fence first polled long after an idle frame. Continuous motion
      // polls every RAF; an idle canvas can stay untouched for minutes.
      const elapsed = performance.now() - submittedAt;
      if (fencePolled || elapsed < 100) frameMs = elapsed;
      gl.deleteSync(submitted); submitted = null;
      return true;
    },
    snapshot(target: CanvasRenderingContext2D) {
      if (disposed || lost || !size) return;
      // Copy only on a character switch, never during normal animation.
      target.drawImage(renderer.domElement, 0, 0);
    },
    async prewarm(variant: FurAvatarVariant) {
      if (disposed || lost || compiledVariants.has(variant)) return;
      const existed = variant === "closure" || (variant === "silverash" ? silverash : variant === "exusiai" ? exusiai : variant === "saileach" ? saileach : mountain);
      const nextRig = variantRig(variant);
      const visible = nextRig.visible;
      nextRig.visible = true;
      renderer.setRenderTarget(presentationTarget);
      const compilation = renderer.compileAsync(nextRig, camera, scene);
      renderer.setRenderTarget(null);
      nextRig.visible = Boolean(existed && visible);
      await compilation;
      if (!disposed && !lost) compiledVariants.add(variant);
    },
    draw(context: CanvasRenderingContext2D | null, pixels: number, pose: FurAvatarPose, variant: FurAvatarVariant = "closure", settings: FurSettings = DEFAULT_FUR_SETTINGS, isCurrent = () => true, requestedWidth?: number, presentation?: { width: number; height: number }, quality: FurRenderQuality = "full") {
      const output = direct ? canvas! : context!.canvas;
      const canvasWidth = requestedWidth ?? output.width;
      const draw = async () => {
      if (lost || disposed || !isCurrent()) return false;
      if (size !== pixels || width !== canvasWidth) {
        if (presentationTarget) presentationTarget.setSize(canvasWidth, pixels);
        else renderer.setSize(canvasWidth, pixels, false);
        size = pixels;
        width = canvasWidth;
        camera.left = -1.35 * canvasWidth / pixels;
        camera.right = 1.35 * canvasWidth / pixels;
        camera.updateProjectionMatrix();
      }
      const press = Math.max(0, pose.press);
      const squint = eyeSquintInfluence(pose.press);
      const snow = variant === "silverash" ? (silverash ??= buildSilverash()) : undefined;
      const angel = variant === "exusiai" ? (exusiai ??= buildExusiai()) : undefined;
      const willow = variant === "saileach" ? (saileach ??= buildSaileach()) : undefined;
      const tiger = variant === "mountain" ? (mountain ??= buildMountain()) : undefined;
      // Subpixel fuzz is noisy on tiny chat portraits; the stitches remain.
      if (angel) for (const child of angel.embroidery.children) if (child instanceof LineSegments) child.visible = pixels >= 240;
      rig.visible = !snow && !angel && !willow && !tiger;
      if (silverash) silverash.rig.visible = !!snow;
      if (exusiai) exusiai.rig.visible = !!angel;
      if (saileach) saileach.rig.visible = !!willow;
      if (mountain) mountain.rig.visible = !!tiger;
      const activeRig = snow?.rig ?? angel?.rig ?? willow?.rig ?? tiger?.rig ?? rig;
      activeRig.rotation.set(pose.pitch + settings.pitch * Math.PI / 180, pose.yaw + settings.yaw * Math.PI / 180, -(pose.inertiaX ?? 0) * 0.08, "YXZ");
      if (camera.zoom !== settings.zoom) { camera.zoom = settings.zoom; camera.updateProjectionMatrix(); }
      const avatarScale = willow ? 1.16 : snow || tiger ? 1.10 : angel ? 1.05 : 1;
      activeRig.scale.set(avatarScale * (1 + pose.press * 0.04), avatarScale * (1 - pose.press * 0.07), avatarScale);
      if (snow) {
        snow.tail.rotation.z = pose.lagX * 0.3 + press * 0.10 + (pose.active ? Math.sin(pose.time * 1.7) * 0.075 : 0);
        for (let i = 0; i < snow.ears.length; i++) {
          const side = i === 0 ? -1 : 1;
          snow.ears[i].rotation.z = -side * (0.17 + press * 0.11 + pose.lagY * 0.2);
          snow.ears[i].rotation.y = side * (0.06 + pose.lagX * 0.35);
        }
      } else if (angel) {
        angel.halo.position.y = 0.70 + (pose.active ? Math.sin(pose.time * 1.7) * 0.018 : 0) + pose.lagY * 0.05;
        angel.halo.rotation.z = 0;
        for (let i = 0; i < angel.wings.length; i++) {
          const side = i === 0 ? -1 : 1;
          angel.wings[i].rotation.y = side * (0.12 + pose.lagX * 0.4 + press * 0.22);
          angel.wings[i].rotation.z = side * (pose.lagY * 0.15 + (pose.active ? Math.sin(pose.time * 2.3) * 0.045 : 0));
        }
      } else if (willow) {
        willow.braid.rotation.z = pose.lagX * 0.3 + (pose.active ? Math.sin(pose.time * 1.7) * 0.035 : 0);
      } else if (tiger) {
        tiger.tail.rotation.z = pose.lagX * 0.25 + (pose.active ? Math.sin(pose.time * 1.5) * 0.05 : 0);
        tiger.ears.forEach((ear, i) => { ear.rotation.z = (i === 0 ? 1 : -1) * (0.18 + press * 0.10); });
      } else {
        for (let i = 0; i < wings.length; i++) {
          const side = i === 0 ? -1 : 1;
          wings[i].rotation.y = side * (0.14 + pose.lagX * 0.55 + press * 0.3 + (pose.active ? Math.sin(pose.time * 2) * 0.075 : 0));
          wings[i].rotation.z = side * (pose.lagY * 0.25 - press * 0.08);
        }
      }
      // Stronger eye compression follows the same spring as the body.
      for (const eye of snow?.eyes ?? angel?.eyes ?? willow?.eyes ?? tiger?.eyes ?? eyes) {
        eye.morphTargetInfluences![0] = squint;
        for (const child of eye.children) if (child instanceof Mesh && child.morphTargetInfluences) child.morphTargetInfluences[0] = squint;
        const { mask, rest } = eyeMasks.get(eye)!;
        mask.z = rest.z * (1 + (EYE_SQUINT_WIDTH - 1) * squint);
        mask.w = rest.w * (1 + (EYE_SQUINT_HEIGHT - 1) * squint);
        eye.material.roughness = settings.eyeRoughness;
        eye.material.clearcoat = settings.eyeClearcoat;
      }
      if (angel) for (const child of angel.embroidery.children) {
        if ((child instanceof Mesh || child instanceof LineSegments) && child.morphTargetInfluences) child.morphTargetInfluences[0] = squint;
      }
      if (angel) {
        angel.accessoryMaterial.roughness = settings.eyeRoughness;
        angel.accessoryMaterial.clearcoat = settings.eyeClearcoat;
        angel.halo.material.roughness = Math.max(0.4, settings.eyeRoughness);
        angel.halo.material.clearcoat = settings.eyeClearcoat * 0.7;
      }
      for (const material of snow?.coats ?? angel?.coats ?? willow?.coats ?? tiger?.coats ?? closureCoats) {
        const base = coatSettings.get(material)!;
        // Both buffers and the shared shader are cached. Quality changes never
        // rebuild geometry or trigger a new shader compilation during motion.
        base.mesh.geometry = quality === "lite" || (!canvas && pixels <= 192) ? base.liteGeometry : base.geometry;
        base.mesh.geometry.instanceCount = settings.shells;
        material.uniforms.uLite.value = quality === "lite" ? 1 : 0;
        material.uniforms.uShells.value = settings.shells;
        material.uniforms.uLength.value = base.length * settings.length;
        material.uniforms.uDensity.value = base.density * settings.density;
        material.uniforms.uThickness.value = settings.thickness;
        material.uniforms.uMess.value = settings.mess;
        material.uniforms.uCurl.value = settings.curl;
        material.uniforms.uGravity.value = settings.gravity;
        material.uniforms.uBrightness.value = settings.brightness;
        material.uniforms.uRim.value = settings.rim;
        material.uniforms.uWind.value = settings.wind;
        material.uniforms.uTime.value = pose.time;
        material.uniforms.uMotion.value = pose.active ? 1 : 0;
        material.uniforms.uPress.value = press;
        material.uniforms.uEyeSquint.value = squint;
        material.uniforms.uTouch.value.set(pose.yaw * 2, -pose.pitch * 2);
        material.uniforms.uLag.value.set(pose.lagX * 4 + (pose.inertiaX ?? 0), pose.lagY * 4);
      }
      if (!compiledVariants.has(variant)) {
        renderer.setRenderTarget(presentationTarget);
        try { await renderer.compileAsync(activeRig, camera, scene); }
        finally { renderer.setRenderTarget(null); }
        compiledVariants.add(variant);
        if (disposed || !isCurrent()) return false;
      }
      submittedAt = performance.now();
      gpuTimer.begin();
      try {
      if (presentationTarget && outputPass) {
        const nextWidth = presentation?.width ?? canvasWidth;
        const nextHeight = presentation?.height ?? pixels;
        if (surfaceWidth !== nextWidth || surfaceHeight !== nextHeight) {
          renderer.setSize(nextWidth, nextHeight, false);
          surfaceWidth = nextWidth; surfaceHeight = nextHeight;
        }
        renderer.setRenderTarget(presentationTarget);
        renderer.render(scene, camera);
        outputPass.render(renderer, presentationTarget, presentationTarget, 0, false);
      } else renderer.render(scene, camera);
      } finally { gpuTimer.end(); }
      if (direct) {
        if (submitted) gl.deleteSync(submitted);
        submitted = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        fencePolled = false;
        gl.flush();
        return true;
      }
      // Hardware canvas-to-canvas copies stay on the GPU and preserve command
      // ordering. A CPU fence here stalls Chromium's offscreen submission queue.
      // Software copies can block input, so they still need an asynchronous fence.
      if ((software && !await waitForGpu()) || disposed || !isCurrent()) return false;
      if (!context) return false;
      // Keep the last presented bitmap visible while a resized frame is on the
      // GPU. Clearing the 2D canvas earlier would flash during quality changes.
      if (context.canvas.width !== canvasWidth) context.canvas.width = canvasWidth;
      if (context.canvas.height !== pixels) context.canvas.height = pixels;
      context.clearRect(0, 0, canvasWidth, pixels);
      context.drawImage(renderer.domElement, 0, 0, canvasWidth, pixels);
      // Hardware copies are asynchronous; keep completed GPU timing in the
      // device budget so slow cards still downgrade even if submission is cheap.
      frameMs = Math.max(performance.now() - submittedAt, gpuTimer.milliseconds() ?? 0);
      return true;
      };
      const result = pendingDraw.then(draw);
      pendingDraw = result.catch(() => false);
      return result;
    },
    dispose() {
      disposed = true;
      gpuTimer.dispose();
      if (submitted) gl.deleteSync(submitted);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      environment.dispose();
      presentationTarget?.dispose();
      outputPass?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

// ONE shared WebGL renderer; historical portraits use cheap 2D canvas copies.
let shared: ReturnType<typeof buildRenderer> | undefined;
let users = 0;
let disposalTimer: ReturnType<typeof setTimeout> | undefined;
export async function acquireFurRenderer() {
  const environmentData = await loadEnvironment();
  clearTimeout(disposalTimer);
  shared ??= buildRenderer(environmentData);
  const resource = shared;
  users++;
  let released = false;
  return {
    direct: false,
    software: resource.software,
    gpuMs: resource.gpuMs,
    frameMs: resource.frameMs,
    surface: undefined as HTMLCanvasElement | undefined,
    draw: resource.draw,
    ready: () => true,
    snapshot: resource.snapshot,
    prewarm: resource.prewarm,
    release() {
      if (released) return;
      released = true;
      // Dialog close/reopen and route changes often overlap by a few frames.
      // Keep the idle resource briefly to avoid rebuilding shaders and the PMREM.
      if (--users === 0) disposalTimer = setTimeout(() => {
        if (users === 0 && shared === resource) { resource.dispose(); shared = undefined; }
      }, 5_000);
    },
  };
}

/** Fullscreen gallery owns its visible WebGL canvas; chat keeps shared copies. */
export async function acquireGalleryFurRenderer(canvas: HTMLCanvasElement) {
  const resource = buildRenderer(await loadEnvironment(), canvas);
  return { direct: resource.direct, software: resource.software, gpuMs: resource.gpuMs, frameMs: resource.frameMs, surface: resource.direct ? canvas : document.createElement("canvas"), draw: resource.draw, ready: resource.ready, snapshot: resource.snapshot, prewarm: resource.prewarm, release: resource.dispose };
}
