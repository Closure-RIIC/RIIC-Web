import { DataTexture, LinearFilter, SRGBColorSpace } from "three";

/** Sparse tiger stripes on the furry sphere; eyes are separate deformable lenses. */
export function createMountainCoat() {
  const size = 512;
  const canvas = document.createElement("canvas"), mask = document.createElement("canvas");
  canvas.width = canvas.height = mask.width = mask.height = size;
  const color = canvas.getContext("2d"), regions = mask.getContext("2d");
  if (!color || !regions) throw new Error("Cannot create the plush coat");
  color.fillStyle = "#f0f0ed";
  color.fillRect(0, 0, size, size);
  regions.fillStyle = "#fff";
  regions.fillRect(0, 0, size, size);
  for (const context of [color, regions]) context.setTransform(size / 1.48, 0, 0, -size / 1.42, size / 2, size / 2 - 0.10 * size / 1.42);
  const paint = (path: string | Path2D, fill: string, furry = true) => {
    const shape = typeof path === "string" ? new Path2D(path) : path;
    color.fillStyle = fill; color.fill(shape);
    regions.fillStyle = furry ? "#fff" : "#000"; regions.fill(shape);
  };
  // Broken lightning-like stripes: uneven bends, tapered tips and asymmetric forks.
  for (const stripe of [
    "M-.12 .62L.025 .59L-.015 .49L.075 .47L-.025 .29L-.003 .41L-.09 .43L-.055 .52Z",
    "M-.49 .45L-.35 .42L-.29 .46L-.21 .36L-.09 .31L-.27 .34L-.32 .38L-.48 .35Z",
    "M.45 .48L.34 .41L.25 .44L.21 .35L.12 .30L.30 .34L.32 .38L.49 .39Z",
    "M-.74 .25L-.59 .18L-.52 .23L-.44 .13L-.33 .09L-.49 .12L-.55 .16L-.65 .11L-.74 .14Z",
    "M.74 .24L.61 .23L.56 .15L.47 .18L.35 .08L.52 .11L.58 .10L.64 .16L.74 .13Z",
    "M-.75 -.07L-.62 -.12L-.56 -.06L-.48 -.18L-.36 -.23L-.53 -.20L-.59 -.16L-.67 -.23L-.75 -.20Z",
    "M.75 -.15L.62 -.11L.56 -.19L.49 -.16L.38 -.26L.55 -.23L.60 -.28L.65 -.22L.74 -.27Z",
    "M-.67 -.38L-.56 -.34L-.51 -.40L-.43 -.34L-.30 -.39L-.46 -.44L-.49 -.50L-.59 -.46L-.61 -.53Z",
    "M.65 -.43L.55 -.39L.50 -.45L.42 -.40L.32 -.46L.47 -.49L.52 -.56L.58 -.49L.62 -.53Z",
  ]) paint(stripe, "#35383c");
  const pixels = color.getImageData(0, 0, size, size).data;
  const coverage = regions.getImageData(0, 0, size, size).data;
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = coverage[i];
  const texture = new DataTexture(new Uint8Array(pixels), size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
