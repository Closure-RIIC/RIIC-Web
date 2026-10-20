import {
  BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshPhysicalMaterial, TubeGeometry, Vector3,
  type DataTexture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { eyeSurfaceZ } from "./fur-detail";
import { addEyeSquintMorph } from "./eye-squint";

const CENTER = [0, -0.13, 0] as const;
const RADII = [0.74, 0.70, 0.74] as const;
type Point = [number, number];

/** Raised satin stitches with short cotton fibers, all attached to the head surface. */
export function createExusiaiEmbroidery(coat: DataTexture) {
  const group = new Group();
  group.name = "exusiai-embroidery";
  const image = coat.image;
  const data = image.data;
  if (!data) return group;
  const mask = (x: number, y: number, region: number) => {
    const u = Math.floor((x / RADII[0] * 0.5 + 0.5) * image.width);
    const v = Math.floor((0.5 - (y - CENTER[1]) / RADII[1] * 0.5) * image.height);
    if (u < 0 || v < 0 || u >= image.width || v >= image.height) return false;
    // The coat mask also clips stitches under the fringe and glossy eye.
    return Math.abs(Number(data[(v * image.width + u) * 4 + 3]) - region) < 15;
  };
  const random = (seed: number) => {
    const n = Math.sin(seed * 127.1 + 17.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const cottonHighlight = new Color("#eadbcd");

  const ring: Point[][] = [];
  for (let stitch = 0; stitch < 112; stitch++) {
    const angle = stitch / 112 * Math.PI * 2;
    const points: Point[] = [];
    for (let step = 0; step <= 8; step++) {
      const t = step / 8;
      const x = -0.25 + Math.cos(angle) * (0.1055 + t * 0.0065);
      const y = -0.025 + Math.sin(angle) * (0.1405 + t * 0.0065);
      if (mask(x, y, 64)) points.push([x, y]);
    }
    if (points.length >= 3) ring.push(points);
  }

  const mouth: Point[][] = [];
  for (let offset = -0.17; offset <= 0.08; offset += 0.004) {
    let run: Point[] = [];
    const flush = () => { if (run.length >= 3) mouth.push(run); run = []; };
    for (let along = 0.1; along <= 0.4; along += 0.0015) {
      const x = 0.92 * offset + 0.38 * along;
      const y = 0.38 * offset - 0.92 * along;
      if (mask(x, y, 102)) run.push([x, y]);
      else flush();
    }
    flush();
  }

  for (const [label, paths, shade] of [["eye-ring", ring, "#57392c"], ["mouth", mouth, "#b66c57"]] as const) {
    const pieces: TubeGeometry[] = [];
    const hairs: number[] = [];
    const hairColors: number[] = [];
    const baseColor = new Color(shade);
    const tint = new Color();
    paths.forEach((points, stitchIndex) => {
      const curve = new CatmullRomCurve3(points.map(([x, y], i) => {
        const t = i / (points.length - 1);
        const relief = 0.004 + Math.sin(t * Math.PI) * 0.0035;
        return new Vector3(x, y, eyeSurfaceZ(x, y, CENTER, RADII) + relief);
      }));
      // Two fine twisted plies form one stitch, rather than a smooth plastic tube.
      for (const side of [-1, 1]) {
        const ply = new CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => {
          const t = i / 12, point = curve.getPoint(t), tangent = curve.getTangent(t);
          const normal = new Vector3(point.x / RADII[0] ** 2, (point.y - CENTER[1]) / RADII[1] ** 2, point.z / RADII[2] ** 2).normalize();
          const across = new Vector3().crossVectors(tangent, normal).normalize();
          const phase = t * Math.PI * (label === "eye-ring" ? 3 : 9) + stitchIndex * 0.6;
          return point.addScaledVector(across, Math.cos(phase) * side * 0.0006).addScaledVector(normal, Math.sin(phase) * side * 0.0006);
        }));
        pieces.push(new TubeGeometry(ply, label === "eye-ring" ? 12 : 24, 0.0010, 5, false));
      }
      const count = label === "eye-ring" ? 9 : Math.max(12, Math.ceil(curve.getLength() / 0.0025));
      for (let fiber = 0; fiber < count; fiber++) {
        const seed = stitchIndex * 101 + fiber * 7 + (label === "mouth" ? 30000 : 0);
        const root = curve.getPoint(random(seed));
        const normal = new Vector3(root.x / RADII[0] ** 2, (root.y - CENTER[1]) / RADII[1] ** 2, root.z / RADII[2] ** 2).normalize();
        const lean = new Vector3(random(seed + 1) - 0.5, random(seed + 2) - 0.5, 0);
        const length = 0.003 + random(seed + 3) * 0.0035;
        root.addScaledVector(lean, 0.0015).addScaledVector(normal, 0.001);
        const middle = root.clone().addScaledVector(normal, length * 0.55).addScaledVector(lean, length * 0.25);
        const tip = root.clone().addScaledVector(normal, length * 0.8).addScaledVector(lean, length);
        hairs.push(...root.toArray(), ...middle.toArray(), ...middle.toArray(), ...tip.toArray());
        tint.copy(baseColor).lerp(cottonHighlight, 0.12 + random(seed + 4) * 0.14);
        for (let vertex = 0; vertex < 4; vertex++) hairColors.push(tint.r, tint.g, tint.b);
      }
    });
    if (!pieces.length) continue;
    const geometry = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    if (!geometry) continue;
    if (label === "eye-ring") addEyeSquintMorph(geometry, [-0.25, -0.025], CENTER, RADII);
    const material = new MeshPhysicalMaterial({ color: shade, roughness: 0.9, metalness: 0, clearcoat: 0, sheen: 0.75, sheenColor: new Color(shade).lerp(cottonHighlight, 0.25), sheenRoughness: 0.9 });
    const stitches = new Mesh(geometry, material);
    stitches.name = `${label}-stitches`;
    group.add(stitches);
    const fiberGeometry = new BufferGeometry();
    fiberGeometry.setAttribute("position", new Float32BufferAttribute(hairs, 3));
    fiberGeometry.setAttribute("color", new Float32BufferAttribute(hairColors, 3));
    if (label === "eye-ring") addEyeSquintMorph(fiberGeometry, [-0.25, -0.025], CENTER, RADII);
    const fibers = new LineSegments(fiberGeometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false }));
    fibers.name = `${label}-short-fibers`;
    group.add(fibers);
  }
  return group;
}
