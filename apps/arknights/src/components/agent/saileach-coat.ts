import { DataTexture, LinearFilter, SRGBColorSpace } from "three";

/** Eyes sit directly on the furry body; fringe and headband follow its curvature. */
export function createSaileachCoat() {
  const size = 512;
  const canvas = document.createElement("canvas"), mask = document.createElement("canvas");
  canvas.width = canvas.height = mask.width = mask.height = size;
  const color = canvas.getContext("2d"), regions = mask.getContext("2d");
  if (!color || !regions) throw new Error("Cannot create the plush coat");
  color.fillStyle = "#f4d68b";
  color.fillRect(0, 0, size, size);
  regions.fillStyle = "#fff";
  regions.fillRect(0, 0, size, size);
  for (const context of [color, regions]) context.setTransform(size / 1.44, 0, 0, -size / 1.40, size / 2, size / 2 - 0.08 * size / 1.40);
  const paint = (path: Path2D, fill: string, furry = false, surface = "#000") => {
    color.fillStyle = fill;
    color.fill(path);
    regions.fillStyle = furry ? "#fff" : surface;
    regions.fill(path);
  };
  // Eyes and their fine rims are deformable meshes; the coat beneath stays furry.
  paint(new Path2D("M-.53 -.35 C-.66 -.08 -.56 .41 -.22 .50 C.16 .62 .53 .40 .56 .12 L.48 -.34 Q.37 -.20 .34 .09 Q.22 .05 .12 .13 L.04 .03 Q-.09 .12 -.06 .27 Q-.24 .10 -.40 .06 L-.43 -.35Z"), "#dcb867", true);
  // The navy band and small gold badge are painted on the crown, not floating plates.
  const headband = new Path2D("M-.45 .32 Q-.02 .68 .44 .32 L.48 .20 Q.03 .48 -.49 .19Z");
  paint(headband, "#304768", false, "#404040");
  color.save();
  color.clip(headband);
  color.strokeStyle = "#7892ae";
  color.lineWidth = 0.009;
  color.beginPath();
  for (let x = -1.2; x <= 1.2; x += 0.14) {
    color.moveTo(x, 0.1); color.lineTo(x + 0.6, 0.7);
    color.moveTo(x, 0.1); color.lineTo(x - 0.6, 0.7);
  }
  color.stroke();
  color.restore();
  paint(new Path2D("M-.16 .39 L-.10 .45 L-.04 .39 L-.10 .33Z"), "#f9dc8a", false, "#666666");
  const pixels = color.getImageData(0, 0, size, size).data;
  const coverage = regions.getImageData(0, 0, size, size).data;
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = coverage[i];
  const texture = new DataTexture(new Uint8Array(pixels), size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
