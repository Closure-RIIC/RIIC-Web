import { Buffer } from "node:buffer";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";

import sharp from "sharp";

const sourceDirectory = path.resolve("apps/arknights/public/images/building-room-backgrounds");
const outputDirectory = path.resolve("apps/arknights/public/images/building-room-emblems");
const sourceAlphaThreshold = 240;
const backgroundLuminance = 52;
const foregroundLuminance = 84;
const outputScale = 4;
const visibleAlphaThreshold = 8;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coverageForPixel(red, green, blue, alpha) {
  if (alpha < sourceAlphaThreshold) return 0;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return clamp(
    (luminance - backgroundLuminance) / (foregroundLuminance - backgroundLuminance),
    0,
    1
  );
}

await mkdir(outputDirectory, { recursive: true });
const sourceFiles = (await readdir(sourceDirectory))
  .filter((file) => file.endsWith(".webp"))
  .sort();

for (const sourceFile of sourceFiles) {
  const sourcePath = path.join(sourceDirectory, sourceFile);
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const extracted = Buffer.alloc(info.width * info.height * 4);
  let minimumVisibleY = info.height;
  let maximumVisibleY = -1;

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    const coverage = coverageForPixel(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );
    extracted[offset] = foregroundLuminance;
    extracted[offset + 1] = foregroundLuminance;
    extracted[offset + 2] = foregroundLuminance;
    const alpha = Math.round(coverage * 255);
    extracted[offset + 3] = alpha;
    if (alpha >= visibleAlphaThreshold) {
      const y = Math.floor(index / info.width);
      minimumVisibleY = Math.min(minimumVisibleY, y);
      maximumVisibleY = Math.max(maximumVisibleY, y);
    }
  }

  if (maximumVisibleY < minimumVisibleY) {
    throw new Error(`No visible emblem pixels found in ${sourceFile}`);
  }

  // Keep one source pixel for antialiasing, but remove the large transparent
  // top/bottom canvas padding so `background-size: auto 100%` scales the emblem,
  // not its unused source canvas, to the card height.
  const cropTop = Math.max(0, minimumVisibleY - 1);
  const cropBottom = Math.min(info.height - 1, maximumVisibleY + 1);
  const croppedHeight = cropBottom - cropTop + 1;

  const outputName = sourceFile.replace(/^bk_/, "emblem_").replace(/\.webp$/, ".png");
  await sharp(extracted, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .extract({ left: 0, top: cropTop, width: info.width, height: croppedHeight })
    .resize(info.width * outputScale, croppedHeight * outputScale, {
      kernel: sharp.kernel.lanczos3,
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      colours: 256,
      dither: 0,
    })
    .toFile(path.join(outputDirectory, outputName));
  stdout.write(
    `${sourceFile} -> ${outputName} (${info.width * outputScale}x${croppedHeight * outputScale}, y=${cropTop}..${cropBottom})\n`
  );
}
