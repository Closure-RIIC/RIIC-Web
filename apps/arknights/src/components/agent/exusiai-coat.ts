import { DataTexture, LinearFilter, SRGBColorSpace } from "three";

/** One painted coat on the sphere: alpha marks fur versus smooth embroidered face. */
export function createExusiaiCoat() {
  const size = 512;
  const canvas = document.createElement("canvas");
  const mask = document.createElement("canvas");
  canvas.width = canvas.height = mask.width = mask.height = size;
  const color = canvas.getContext("2d");
  const regions = mask.getContext("2d");
  if (!color || !regions) throw new Error("Cannot create the plush coat");
  color.fillStyle = "#ff3b42";
  color.fillRect(0, 0, size, size);
  regions.fillStyle = "#fff";
  regions.fillRect(0, 0, size, size);
  // Author in the same frontal coordinates as the 0.74 × 0.70 plush sphere.
  for (const context of [color, regions]) context.setTransform(size / 1.48, 0, 0, -size / 1.40, size / 2, size / 2 - 0.13 * size / 1.40);
  const paint = (path: Path2D, fill: string, furry = false, surface = "#000") => {
    color.fillStyle = fill;
    color.fill(path);
    regions.fillStyle = furry ? "#fff" : surface;
    regions.fill(path);
  };
  paint(new Path2D("M-.46 -.28 C-.54 -.08 -.33 .25 -.15 .31 C.10 .32 .43 .09 .46 -.20 C.52 -.40 .21 -.43 -.11 -.42 Q-.40 -.44 -.46 -.28Z"), "#f1d4ac");
  const rim = new Path2D();
  // Keep an 0.008-wide embroidered edge around the unchanged glossy eye.
  rim.ellipse(-0.25, -0.025, 0.113, 0.148, 0, 0, Math.PI * 2);
  paint(rim, "#57392c", false, "#404040");
  const eye = new Path2D();
  eye.ellipse(-0.25, -0.025, 0.105, 0.14, 0, 0, Math.PI * 2);
  paint(eye, "#ffe02b");
  paint(new Path2D("M-.035 -.20 L.095 -.165 C.085 -.29 .04 -.35 .005 -.29Z"), "#b66c57", false, "#666666");
  paint(new Path2D("M-.50 -.31 C-.72 -.02 -.58 .40 -.20 .53 C.15 .66 .60 .43 .61 .10 Q.65 -.15 .51 -.22 Q.54 -.10 .51 -.06 C.48 -.25 .40 -.35 .24 -.36 Q.21 -.34 .21 -.23 Q.20 -.11 .16 -.07 C0 -.11 -.16 .08 -.18 .28 C-.30 .20 -.46 -.08 -.45 -.24 L-.43 -.34Z"), "#b91f31", true);
  const pixels = color.getImageData(0, 0, size, size).data;
  const coverage = regions.getImageData(0, 0, size, size).data;
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = coverage[i];
  // DataTexture preserves RGB in smooth (alpha=0) regions; no transparent mesh layers.
  const texture = new DataTexture(new Uint8Array(pixels), size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
