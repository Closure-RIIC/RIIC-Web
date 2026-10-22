// Bake smooth, non-periodic grooming on the CPU once per mesh, not every shell/frame.
function hash(x: number, y: number, z: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  let value = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    value += hash(ix + dx, iy + dy, iz + dz) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  }
  return value * 2 - 1;
}

export function furGroom(x: number, y: number, z: number): [number, number, number] {
  return [0, 17.3, 39.1].map(seed =>
    noise(x * 3.7 + seed, y * 3.7 + 7.1, z * 3.7 - seed) * 0.6
    + noise((z + y * 0.4) * 9.1 + seed, (x - z * 0.3) * 9.1, y * 9.1 + seed) * 0.3
    + noise(y * 19.3 - seed, z * 19.3 + seed, x * 19.3) * 0.15,
  ) as [number, number, number];
}

/** Depth of an eye anchored to an ellipsoid, so side views stay flush with the body. */
export function eyeSurfaceZ(x: number, y: number, center: readonly number[], radii: readonly number[]) {
  const nx = (x - center[0]) / radii[0], ny = (y - center[1]) / radii[1];
  return center[2] + radii[2] * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
}

export const EYE_SQUINT_WIDTH = 1.04;
export const EYE_SQUINT_HEIGHT = 0.5;

export function eyeSquintInfluence(press: number) {
  const amount = Number.isFinite(press) ? Math.max(0, Math.min(1, press)) : 0;
  return amount * amount * (3 - 2 * amount);
}

/** Keep the closing eye and embroidery bonded to the curved plush surface. */
export function squintedEyePoint(point: readonly number[], eye: readonly number[], center: readonly number[], radii: readonly number[]): [number, number, number] {
  const x = eye[0] + (point[0] - eye[0]) * EYE_SQUINT_WIDTH;
  const y = eye[1] + (point[1] - eye[1]) * EYE_SQUINT_HEIGHT;
  const relief = point[2] - eyeSurfaceZ(point[0], point[1], center, radii);
  return [x, y, eyeSurfaceZ(x, y, center, radii) + relief * 0.65];
}
