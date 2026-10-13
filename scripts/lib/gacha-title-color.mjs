import sharp from "sharp";

// Alpha-weighted hue histogram: ignore transparent padding and neutral lettering
// so a white backdrop cannot wash out the title's characteristic color.
export async function extractTitleAccent(images) {
  const buckets = Array.from({ length: 24 }, () => ({ weight: 0, red: 0, green: 0, blue: 0 }));
  let opaqueWeight = 0;
  for (const image of images) {
    const { data, info } = await sharp(image).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const [red, green, blue, alpha] = data.subarray(offset, offset + 4);
      if (alpha < 32) continue;
      opaqueWeight += alpha / 255;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const delta = max - min;
      const saturation = max ? delta / max : 0;
      if (max < 45 || saturation < .18) continue;
      const hue = ((max === red ? (green - blue) / delta : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4) * 60 + 360) % 360;
      const bucket = buckets[Math.round(hue / 15) % buckets.length];
      const weight = (alpha / 255) ** 2 * saturation ** 2;
      bucket.weight += weight;
      bucket.red += red * weight;
      bucket.green += green * weight;
      bucket.blue += blue * weight;
    }
  }
  const dominant = buckets.reduce((best, bucket) => bucket.weight > best.weight ? bucket : best);
  if (!dominant.weight || dominant.weight < opaqueWeight * .004) return null;
  return `#${[dominant.red, dominant.green, dominant.blue].map((value) => Math.round(value / dominant.weight).toString(16).padStart(2, "0")).join("")}`;
}
