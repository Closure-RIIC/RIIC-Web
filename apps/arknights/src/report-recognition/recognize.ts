import { DIGIT_TEMPLATES, DIGIT_TEMPLATE_HEIGHT, DIGIT_TEMPLATE_VARIANTS, DIGIT_TEMPLATE_WIDTH } from "./templates.ts";
import { RECOGNITION_CONFIDENT_DISTANCE, type RecognizedDay, type ReportMetricKey, type ReportRecognitionOutcome, type ReportRecognitionResult } from "./types.ts";

/**
 * 基建报表截图识别（纯前端，无第三方依赖）。
 *
 * 流程与实测依据见仓库外交接文档；关键常量均以 1763 宽截图为基准（BASE_WIDTH），
 * 面板内部尺寸按黄色锚点高度缩放。所有阶段都允许部分失败：定位不到的行留给用户手填。
 */

const BASE_WIDTH = 1763;

/**
 * 数值字形窗口（相对面板锚点中心）。实测：数字最远到 +319（146000），
 * 汇总句的句尾文字从 +325 起，右侧百分比从约 +306 起；作战记录行的 EXP
 * 字母最远到 +247，其后数字从 +249 起，所以该行窗口左界单独右移避开 P。
 */
const VALUE_X0 = 249;
const VALUE_X0_EXPERIENCE = 248;
const VALUE_X1 = 322;
const ORDER_X0 = 421;
const ORDER_X1 = 467;
const VALUE_PROBE_X0 = 240;
const VALUE_PROBE_X1 = 300;
/** 标签列窗口；句尾探针（+320~+360）用于识别“总计制造了价值…”汇总句行。 */
const LABEL_X0 = 15;
const LABEL_X1 = 360;

type RecognitionProfile = {
  id: "standard" | "wide-strip";
  valueX0: number;
  experienceX0: number;
  valueProbeX0: number;
  valueProbeX1: number;
  orderX0: number;
  orderX1: number;
};

const STANDARD_PROFILE: RecognitionProfile = {
  id: "standard", valueX0: VALUE_X0, experienceX0: VALUE_X0_EXPERIENCE,
  valueProbeX0: VALUE_PROBE_X0, valueProbeX1: VALUE_PROBE_X1,
  orderX0: ORDER_X0, orderX1: ORDER_X1,
};

// The report strip exported by the desktop client is wider than 16:9. Its
// columns move farther apart while the text stays at the icon's scale, and
// the value column starts a little earlier than the 16:9 layout.
const WIDE_STRIP_PROFILE: RecognitionProfile = {
  id: "wide-strip", valueX0: 244, experienceX0: 240,
  valueProbeX0: 224, valueProbeX1: 306,
  orderX0: 410, orderX1: 472,
};

function profileForRatio(ratio: number): RecognitionProfile | undefined {
  if (ratio >= 1.92 && ratio <= 2.35) return WIDE_STRIP_PROFILE;
  if (ratio >= 1.55 && ratio < 1.92) return STANDARD_PROFILE;
  return undefined;
}

export function recognitionProfileIdForRatio(ratio: number): "standard" | "wide-strip" | "fallback" {
  return profileForRatio(ratio)?.id ?? "fallback";
}

type Rgba = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

type Ink = { at(x: number, y: number): boolean; cyanAt(x: number, y: number): boolean; width: number; height: number; scale: number };

/** 数值艺术字的青色笔画（用于区分数值行与白色百分比等其它内容）。 */
function hsvCyan(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max <= 0.45) return false;
  const d = max - min;
  if (d <= 1e-6) return false;
  const s = d / max;
  if (s < 0.3) return false;
  let h: number;
  if (max === r / 255) h = 60 * (((g - b) / 255 / d) % 6);
  else if (max === g / 255) h = 60 * ((b - r) / 255 / d + 2);
  else h = 60 * ((r - g) / 255 / d + 4);
  if (h < 0) h += 360;
  return h >= 145 && h <= 235;
}

/** 亮色墨迹（含青色与白色文字），用于行带检测与字形提取。 */
function hsvInk(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b) / 255;
  if (max <= 0.46) return false;
  if (hsvCyan(r, g, b)) return true;
  const min = Math.min(r, g, b) / 255;
  return (max - min) / max < 0.48;
}

function isAnchorYellow(r: number, g: number, b: number): boolean {
  return r > 200 && g > 170 && b < 110 && r - b > 110;
}

function makeInk(image: Rgba): Ink {
  const { data, width, height } = image;
  const channels = data.length / (width * height);
  return {
    width,
    height,
    scale: width / BASE_WIDTH,
    at(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const i = (y * width + x) * channels;
      return hsvInk(data[i]!, data[i + 1]!, data[i + 2]!);
    },
    cyanAt(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const i = (y * width + x) * channels;
      return hsvCyan(data[i]!, data[i + 1]!, data[i + 2]!);
    },
  };
}

type Blob = { x0: number; x1: number; y0: number; y1: number; pixels: number };

function yellowAnchors(image: Rgba, s: number): Array<{ x: number; y: number; scale: number }> {
  const { data, width, height } = image;
  const channels = data.length / (width * height);
  const cell = Math.max(4, Math.round(16 * s));
  const grid = new Map<number, number[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (!isAnchorYellow(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
      const key = Math.floor(y / cell) * 100_000 + Math.floor(x / cell);
      const list = grid.get(key);
      if (list) list.push(x, y);
      else grid.set(key, [x, y]);
    }
  }
  const minPixels = Math.max(25, Math.round(55 * s * s));
  const blobs: Blob[] = [];
  const seen = new Set<number>();
  for (const key of grid.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    seen.add(key);
    let pixels = 0;
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    while (stack.length) {
      const current = stack.pop()!;
      const cx = current % 100_000;
      const cy = (current - cx) / 100_000;
      const points = grid.get(current)!;
      for (let j = 0; j < points.length; j += 2) {
        const px = points[j]!, py = points[j + 1]!;
        pixels++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const next = (cy + dy) * 100_000 + (cx + dx);
          if (grid.has(next) && !seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (pixels >= minPixels && w >= 6 * s && w <= 75 * s && h >= 12 * s && h <= 75 * s) {
      blobs.push({ x0, x1, y0, y1, pixels });
    }
  }
  // 面板锚点应近似同一水平线；按行聚类后取数量最多的一行。
  const aligned = new Map<number, Blob[]>();
  for (const blob of blobs) {
    const cy = Math.round((blob.y0 + blob.y1) / 2);
    let placed = false;
    for (const [rowY, list] of aligned) {
      if (Math.abs(rowY - cy) <= 18 * s) {
        list.push(blob);
        placed = true;
        break;
      }
    }
    if (!placed) aligned.set(cy, [blob]);
  }
  let best: Blob[] = [];
  for (const list of aligned.values()) if (list.length > best.length) best = list;
  return best
    .sort((a, b) => a.x0 - b.x0)
    .map((blob) => ({ x: (blob.x0 + blob.x1) / 2, y: (blob.y0 + blob.y1) / 2, scale: (blob.y1 - blob.y0 + 1) / 47 }));
}

type Band = { y0: number; y1: number; x0: number; x1: number; pixels: number };

/** 在标签列窗口内按行投影切出墨迹带。 */
function labelBands(ink: Ink, s: number, anchor: { x: number; y: number }): Band[] {
  const xStart = Math.round(anchor.x + LABEL_X0 * s);
  const xEnd = Math.min(ink.width - 1, Math.round(anchor.x + LABEL_X1 * s));
  const rowInk: number[] = [];
  for (let y = 0; y < ink.height; y++) {
    let count = 0;
    for (let x = xStart; x <= xEnd; x++) if (ink.at(x, y)) count++;
    rowInk.push(count);
  }
  const bands: Band[] = [];
  let start = -1;
  let gap = 0;
  const minRowInk = Math.max(1, Math.round(2 * s));
  for (let y = 0; y < ink.height; y++) {
    if (rowInk[y]! >= minRowInk) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= Math.max(3, Math.round(5 * s))) {
        const end = y - gap;
        if (end - start + 1 >= Math.max(6, Math.round(7 * s))) bands.push({ y0: start, y1: end, x0: 0, x1: 0, pixels: 0 });
        start = -1;
      }
    }
  }
  if (start >= 0 && ink.height - start >= Math.max(6, Math.round(7 * s))) {
    bands.push({ y0: start, y1: ink.height - 1, x0: 0, x1: 0, pixels: 0 });
  }
  // 面板下方（副手信赖及干员列表）不在本次识别范围内，只保留锚点以下的带。
  const panelTop = Math.round(anchor.y - 20 * s);
  return bands.filter((band) => band.y0 >= panelTop).map((band) => measureBand(ink, band, xStart, xEnd));
}

function measureBand(ink: Ink, band: Band, xStart: number, xEnd: number): Band {
  let x0 = Infinity, x1 = -1, pixels = 0;
  for (let y = band.y0; y <= band.y1; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      if (!ink.at(x, y)) continue;
      pixels++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return { ...band, x0: x0 === Infinity ? 0 : x0, x1: x1 === -1 ? 0 : x1, pixels };
}

type Glyph = { x0: number; x1: number; y0: number; y1: number; pixels: number };

/** 在数值窗口内用连通域切分字形；过宽分量在墨水最少的列二次切分。 */
function valueGlyphs(ink: Ink, s: number, anchor: { x: number }, band: Band, xStartOffset: number, xEndOffset = VALUE_X1, cyanOnly = true): Glyph[] {
  const xStart = Math.round(anchor.x + xStartOffset * s);
  const xEnd = Math.min(ink.width - 1, Math.round(anchor.x + xEndOffset * s));
  const yStart = band.y0;
  const yEnd = band.y1;
  const width = xEnd - xStart + 1;
  const height = yEnd - yStart + 1;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cyanOnly ? ink.cyanAt(xStart + x, yStart + y) : ink.at(xStart + x, yStart + y)) mask[y * width + x] = 1;
    }
  }
  const seen = new Uint8Array(width * height);
  let glyphs: Glyph[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!mask[index] || seen[index]) continue;
      const stack = [index];
      seen[index] = 1;
      let pixels = 0;
      let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      while (stack.length) {
        const current = stack.pop()!;
        const cx = current % width;
        const cy = (current - cx) / width;
        pixels++;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const next = ny * width + nx;
            if (mask[next] && !seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          }
        }
      }
      if (pixels >= Math.max(6, Math.round(7 * s * s))) {
        glyphs.push({ x0: xStart + x0, x1: xStart + x1, y0: yStart + y0, y1: yStart + y1, pixels });
      }
    }
  }
  glyphs = glyphs.filter((glyph) => glyph.y1 - glyph.y0 + 1 <= 25 * s);
  glyphs.sort((a, b) => a.x0 - b.x0);
  // 剔除明显矮于主体的杂散分量（数字 1 很窄但占满行高，不受影响）。
  const tallest = Math.max(1, ...glyphs.map((glyph) => glyph.y1 - glyph.y0 + 1));
  glyphs = glyphs.filter((glyph) => glyph.y1 - glyph.y0 + 1 >= tallest * 0.55);
  // 二次切分：宽度显著超过中位数的分量按墨水最少列拆开（实测粘连 “22” 必需）。
  const widths = glyphs.map((glyph) => glyph.x1 - glyph.x0 + 1).sort((a, b) => a - b);
  const median = widths[Math.floor((widths.length - 1) / 2)] ?? 0;
  if (median > 0) {
    const split: Glyph[] = [];
    for (const glyph of glyphs) {
      const w = glyph.x1 - glyph.x0 + 1;
      if (w > median * 1.6 && w < median * 3.2) {
        let bestX = -1, bestInk = Infinity;
        for (let x = glyph.x0 + Math.round(2 * s); x <= glyph.x1 - Math.round(2 * s); x++) {
          let column = 0;
          for (let y = glyph.y0; y <= glyph.y1; y++) if (ink.at(x, y)) column++;
          if (column < bestInk) {
            bestInk = column;
            bestX = x;
          }
        }
        if (bestX > glyph.x0 && bestX < glyph.x1) {
          split.push({ ...glyph, x1: bestX, pixels: 0 }, { ...glyph, x0: bestX + 1, pixels: 0 });
          continue;
        }
      }
      split.push(glyph);
    }
    glyphs = split.sort((a, b) => a.x0 - b.x0);
  }
  return glyphs;
}

/** 保持长宽比地把字形归一化到模板尺寸（按高度缩放，横向居中）。 */
function normalizeGlyph(ink: Ink, glyph: Glyph, cyanOnly: boolean): Uint8Array {
  const glyphWidth = glyph.x1 - glyph.x0 + 1;
  const glyphHeight = glyph.y1 - glyph.y0 + 1;
  const out = new Uint8Array(DIGIT_TEMPLATE_WIDTH * DIGIT_TEMPLATE_HEIGHT);
  const scaledWidth = Math.max(1, Math.round(glyphWidth * (DIGIT_TEMPLATE_HEIGHT / glyphHeight)));
  const offsetX = Math.max(0, Math.round((DIGIT_TEMPLATE_WIDTH - scaledWidth) / 2));
  for (let y = 0; y < DIGIT_TEMPLATE_HEIGHT; y++) {
    const sourceY = glyph.y0 + Math.min(glyphHeight - 1, Math.floor((y * glyphHeight) / DIGIT_TEMPLATE_HEIGHT));
    for (let x = 0; x < DIGIT_TEMPLATE_WIDTH; x++) {
      const tx = x - offsetX;
      if (tx < 0 || tx >= scaledWidth) continue;
      const sourceX = glyph.x0 + Math.min(glyphWidth - 1, Math.floor((tx * glyphWidth) / scaledWidth));
      if (cyanOnly ? ink.cyanAt(sourceX, sourceY) : ink.at(sourceX, sourceY)) out[y * DIGIT_TEMPLATE_WIDTH + x] = 1;
    }
  }
  return out;
}

function templateDistance(glyph: Uint8Array, template: Uint8Array): number {
  let best = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let sum = 0;
      for (let y = 0; y < DIGIT_TEMPLATE_HEIGHT; y++) {
        for (let x = 0; x < DIGIT_TEMPLATE_WIDTH; x++) {
          const ty = y + dy;
          const tx = x + dx;
          const other = ty >= 0 && ty < DIGIT_TEMPLATE_HEIGHT && tx >= 0 && tx < DIGIT_TEMPLATE_WIDTH
            ? template[ty * DIGIT_TEMPLATE_WIDTH + tx]!
            : 0;
          const diff = glyph[y * DIGIT_TEMPLATE_WIDTH + x]! - other;
          sum += diff * diff;
        }
      }
      if (sum < best) best = sum;
    }
  }
  return best / (DIGIT_TEMPLATE_WIDTH * DIGIT_TEMPLATE_HEIGHT);
}

type GlyphMatch = { digit: number; distance: number };

/**
 * 笔画减一像素的模板。模板取自青色数值字，而龙门币订单数量等白色数字在深色
 * 面板上二值化后笔画普遍细一档，直接用同一份模板比对会系统性抬高距离。
 */
function erodeTemplate(template: Uint8Array): Uint8Array {
  const out = new Uint8Array(template.length);
  for (let y = 0; y < DIGIT_TEMPLATE_HEIGHT; y++) {
    for (let x = 0; x < DIGIT_TEMPLATE_WIDTH; x++) {
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= DIGIT_TEMPLATE_HEIGHT || nx < 0 || nx >= DIGIT_TEMPLATE_WIDTH || !template[ny * DIGIT_TEMPLATE_WIDTH + nx]) {
            keep = 0;
            break;
          }
        }
      }
      out[y * DIGIT_TEMPLATE_WIDTH + x] = keep;
    }
  }
  return out;
}

const ERODED_DIGIT_TEMPLATES = DIGIT_TEMPLATES.map(erodeTemplate);

/** 取模板与其细一像素版本中的较小距离，容忍笔画粗细差异。 */
function templateDistanceWithStrokeTolerance(glyph: Uint8Array, digit: number): number {
  return Math.min(templateDistance(glyph, DIGIT_TEMPLATES[digit]!), templateDistance(glyph, ERODED_DIGIT_TEMPLATES[digit]!));
}

function matchGlyph(ink: Ink, glyph: Glyph, cyanOnly: boolean): GlyphMatch {
  const normalized = normalizeGlyph(ink, glyph, cyanOnly);
  let digit = -1;
  let distance = Infinity;
  for (let d = 0; d < DIGIT_TEMPLATES.length; d++) {
    const candidate = templateDistanceWithStrokeTolerance(normalized, d);
    if (candidate < distance) {
      distance = candidate;
      digit = d;
    }
  }
  for (const variant of DIGIT_TEMPLATE_VARIANTS) {
    const candidate = templateDistance(normalized, variant.pixels);
    if (candidate <= RECOGNITION_CONFIDENT_DISTANCE && candidate < distance) {
      distance = candidate;
      digit = variant.digit;
    }
  }
  return { digit, distance };
}

/**
 * 读取一行数值；任一字形不可信时仍返回数值和最大距离，供界面留空并提示核对。
 */
function readRowValue(ink: Ink, s: number, anchor: { x: number }, band: Band, xStartOffset: number, xEndOffset = VALUE_X1, cyanOnly = true): { value: number; maxDistance: number } | undefined {
  const glyphs = valueGlyphs(ink, s, anchor, band, xStartOffset, xEndOffset, cyanOnly);
  if (!glyphs.length) return undefined;
  const tooSmall = glyphs.some((glyph) => glyph.y1 - glyph.y0 + 1 < 12);
  const matches = glyphs.map((glyph) => matchGlyph(ink, glyph, cyanOnly));
  let value = 0;
  let maxDistance = 0;
  for (const match of matches) {
    if (match.digit < 0) return undefined;
    value = value * 10 + match.digit;
    maxDistance = Math.max(maxDistance, match.distance);
  }
  if (value > 99_999_999) return undefined;
  return { value, maxDistance: Math.round(Math.max(maxDistance, tooSmall ? RECOGNITION_CONFIDENT_DISTANCE + 0.001 : 0) * 1000) / 1000 };
}

function bandHasInkBetween(ink: Ink, s: number, anchor: { x: number }, band: Band, fromX: number, toX: number, cyanOnly = false): boolean {
  const x0 = Math.round(anchor.x + fromX * s);
  const x1 = Math.min(ink.width - 1, Math.round(anchor.x + toX * s));
  let count = 0;
  for (let y = band.y0; y <= band.y1; y++) {
    for (let x = x0; x <= x1; x++) if (cyanOnly ? ink.cyanAt(x, y) : ink.at(x, y)) count++;
    if (count >= Math.max(2, Math.round(3 * s))) return true;
  }
  return false;
}

function recognizePanel(ink: Ink, s: number, anchor: { x: number; y: number }, profile: RecognitionProfile): RecognizedDay {
  const bands = labelBands(ink, s, anchor);
  // 极薄的横贯线（分隔线）不参与行分类。
  const content = bands.filter((band) => band.y1 - band.y0 + 1 > Math.round(6 * s));
  // 汇总句行（总计制造了价值…的作战记录/贵金属）：数字右侧仍有文字墨迹。
  const sentences = content.filter((band) =>
    band.y0 >= anchor.y + 30 * s && band.y0 <= anchor.y + 160 * s
    && bandHasInkBetween(ink, s, anchor, band, 330, 360));
  // 数值行：句尾无文字、标签跨度小且数值窗口有墨迹；明细行可能混入，但取最后两条即可。
  const narrowWithValue = content.filter((band) =>
    !sentences.includes(band)
    && band.y0 >= anchor.y + 160 * s && band.y0 <= anchor.y + 330 * s
    && bandHasInkBetween(ink, s, anchor, band, profile.valueProbeX0, profile.valueProbeX1, true));
  const day: RecognizedDay = {};
  const experienceBand = sentences[0];
  const goldBand = sentences[1];
  const orundumBand = narrowWithValue.at(-1);
  const lmdBand = narrowWithValue.at(-2);
  // 龙门币与合成玉两行实测间距约 41-46（基准宽度）；超过则说明中间缺行，宁缺勿错。
  const pairGapOk = !!(lmdBand && orundumBand && orundumBand.y0 - lmdBand.y1 <= 60 * s);
  const pairs: Array<[ReportMetricKey, Band | undefined, number]> = [
    ["experience", experienceBand, profile.experienceX0 - Math.max(0, Math.round((s - 1) * 10))],
    ["goldValue", goldBand, profile.valueX0],
    ["lmd", pairGapOk ? lmdBand : undefined, profile.valueX0],
    ["orundum", orundumBand, profile.valueX0],
  ];
  for (const [key, band, xStart] of pairs) {
    if (!band) continue;
    const value = readRowValue(ink, s, anchor, band, xStart);
    if (value) day[key] = value;
  }
  if (pairGapOk && lmdBand) {
    const orderCount = readRowValue(ink, s, anchor, lmdBand, profile.orderX0, profile.orderX1, false);
    if (orderCount) day.orderCount = orderCount;
  }
  return day;
}

/** 识别基建报表截图。输入为解码后的 RGBA 像素；图片解码由调用方在浏览器完成。 */
export function recognizeReport(image: Rgba): ReportRecognitionOutcome {
  if (!image.width || !image.height) return { ok: false, reason: "decode" };
  const ink = makeInk(image);
  const s = ink.scale;
  const warnings: ReportRecognitionResult["warnings"] = [];
  const ratio = image.width / image.height;
  const profile = profileForRatio(ratio);
  if (!profile) warnings.push("odd-aspect-ratio");
  if (image.width < 1400) warnings.push("low-resolution");
  const anchors = yellowAnchors(image, s);
  if (anchors.length === 0) return { ok: false, reason: "no-panel" };
  const usable = anchors.length >= 3 ? anchors.slice(-3) : anchors.slice(-1);
  if (anchors.length !== usable.length) warnings.push("panel-mismatch");
  // Some game clients export a wide report strip (roughly 2:1) where the
  // distance between panels grows but the panel typography stays at the
  // same size.  Use the yellow icon height for those screenshots instead of
  // deriving the text scale from the column spacing.
  const medianAnchorScale = [...usable.map((anchor) => anchor.scale)].sort((a, b) => a - b)[Math.floor(usable.length / 2)] ?? usable[0]!.scale;
  const panelScale = profile?.id === "wide-strip"
    ? medianAnchorScale
    : usable.length === 3 && image.width < 1600
      ? (usable[2]!.x - usable[0]!.x) / (2 * 588)
      : medianAnchorScale;
  const days = usable.map((anchor) => recognizePanel(ink, panelScale, anchor, profile ?? STANDARD_PROFILE));
  const kind = usable.length === 3 ? "three-day" : "single-day";
  if (kind === "single-day") warnings.push("single-day-report");
  return { panelCount: usable.length, profile: profile?.id ?? "fallback", kind, days, warnings };
}
