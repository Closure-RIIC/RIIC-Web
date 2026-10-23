const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_PIXELS = 16_000_000;
const IMAGE_BORDER = 24;

export function scheduleImageScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Schedule board is not ready");
  }
  return Math.min(2, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
}

async function waitForImages(board: HTMLElement): Promise<void> {
  await Promise.all(Array.from(board.querySelectorAll("img"), (image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        image.removeEventListener("load", done);
        image.removeEventListener("error", done);
        resolve();
      };
      const timer = window.setTimeout(done, 5_000);
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    });
  }));
}

function boardBackgroundColor(board: HTMLElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  const colors: string[] = [];
  for (let element: HTMLElement | null = board; element; element = element.parentElement) {
    colors.push(getComputedStyle(element).backgroundColor);
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 1, 1);
  for (const color of colors.reverse()) {
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
  }
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${red}, ${green}, ${blue})`;
}

async function prepareRoomGridBackgrounds(board: HTMLElement): Promise<void> {
  const view = board.ownerDocument.defaultView!;
  const grids = Array.from(board.querySelectorAll<HTMLElement>(".infra-room-surface > html2canvaspseudoelement"))
    .filter((element) => element.style.maskImage.includes("/images/ui/facility-grid.svg") && element.getBoundingClientRect().width > 0);
  if (!grids.length) return;
  const response = await fetch("/images/ui/facility-grid.svg");
  if (!response.ok) throw new Error("Facility grid could not be loaded");
  const grid = new DOMParser().parseFromString(await response.text(), "image/svg+xml").documentElement;
  const namespace = "http://www.w3.org/2000/svg";
  const svgElement = (name: string, attributes: Record<string, string | number>) => {
    const element = document.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };

  // html2canvas materializes pseudo-elements but does not render CSS masks.
  // Bake the existing vector mask and gradient into an SVG in the export clone.
  for (const element of grids) {
    const style = view.getComputedStyle(element);
    const { width, height } = element.getBoundingClientRect();
    const [tileWidth, tileHeight] = style.maskSize.split(" ").map(Number.parseFloat);
    const color = style.getPropertyValue("--room-grid-color").trim() || "#52b8e8";
    const fadeStart = style.getPropertyValue("--room-grid-fade-start").trim() || "30%";
    const svg = svgElement("svg", { xmlns: namespace, width, height, viewBox: `0 0 ${width} ${height}` });
    const definitions = svgElement("defs", {});
    const gradient = svgElement("linearGradient", { id: "tint", x1: "0%", x2: "100%", y1: "0%", y2: "0%" });
    for (const [offset, opacity] of [["0%", 0], [fadeStart, 0.48], ["100%", 1]] as const) {
      gradient.append(svgElement("stop", { offset, "stop-color": color, "stop-opacity": opacity }));
    }
    const pattern = svgElement("pattern", { id: "grid", patternUnits: "userSpaceOnUse", x: (width - tileWidth) / 2, y: (height - tileHeight) / 2, width: tileWidth, height: tileHeight });
    const tile = grid.cloneNode(true) as Element;
    tile.setAttribute("width", String(tileWidth));
    tile.setAttribute("height", String(tileHeight));
    pattern.append(tile);
    const mask = svgElement("mask", { id: "mask", maskUnits: "userSpaceOnUse", x: 0, y: 0, width, height, "mask-type": "alpha" });
    mask.append(svgElement("rect", { width, height, fill: "url(#grid)" }));
    definitions.append(gradient, pattern, mask);
    svg.append(definitions, svgElement("rect", { width, height, fill: "url(#tint)", mask: "url(#mask)" }));
    const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    element.style.backgroundImage = `url("${image}")`;
    element.style.backgroundSize = "100% 100%";
    element.style.backgroundRepeat = "no-repeat";
    element.style.maskImage = "none";
  }
}

export async function captureScheduleImage(board: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas-pro");
  await document.fonts.ready;
  await waitForImages(board);

  const bounds = board.getBoundingClientRect();
  const width = Math.max(bounds.width, board.scrollWidth);
  const height = Math.max(bounds.height, board.scrollHeight);
  if (width <= 0 || height <= 0) throw new Error("Schedule board is not ready");
  const scale = scheduleImageScale(width + IMAGE_BORDER * 2, height + IMAGE_BORDER * 2);
  const captured = await html2canvas(board, {
    backgroundColor: boardBackgroundColor(board),
    logging: false,
    width,
    height,
    scale,
    useCORS: true,
    onclone: async (_document, clonedBoard) => {
      // The exporter loads image resources itself, including offscreen portraits.
      clonedBoard.querySelectorAll("[data-operator-portrait]").forEach(image => image.classList.remove("invisible"));
      clonedBoard.querySelectorAll("[data-operator-portrait-skeleton]").forEach(skeleton => skeleton.remove());
      await prepareRoomGridBackgrounds(clonedBoard);
    },
  });
  const border = Math.max(1, Math.floor(IMAGE_BORDER * scale));
  const output = document.createElement("canvas");
  output.width = captured.width + border * 2;
  output.height = captured.height + border * 2;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(captured, border, border);
  return output;
}

function cropCanvasToContent(source: HTMLCanvasElement): HTMLCanvasElement {
  try {
    const context = source.getContext("2d");
    if (!context) return source;
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    let left = source.width;
    let top = source.height;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < source.height; y += 2) {
      for (let x = 0; x < source.width; x += 2) {
        const offset = (y * source.width + x) * 4;
        const alpha = pixels[offset + 3];
        const darkest = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        if (alpha > 0 && darkest < 242) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right <= left || bottom <= top) return source;
    const padding = 12;
    const sourceLeft = Math.max(0, left - padding);
    const sourceTop = Math.max(0, top - padding);
    const sourceRight = Math.min(source.width, right + padding);
    const sourceBottom = Math.min(source.height, bottom + padding);
    const cropped = document.createElement("canvas");
    cropped.width = sourceRight - sourceLeft;
    cropped.height = sourceBottom - sourceTop;
    cropped.getContext("2d")?.drawImage(
      source,
      sourceLeft,
      sourceTop,
      sourceRight - sourceLeft,
      sourceBottom - sourceTop,
      0,
      0,
      cropped.width,
      cropped.height,
    );
    return cropped;
  } catch {
    return source;
  }
}

export function composeThreeShiftImage(canvases: HTMLCanvasElement[], titles: string[]): HTMLCanvasElement {
  const output = document.createElement("canvas");
  output.width = 1920;
  output.height = 1080;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas is not available");

  context.fillStyle = "#eef0f1";
  context.fillRect(0, 0, output.width, output.height);
  const padding = 32;
  const gap = 20;
  const columnWidth = (output.width - padding * 2 - gap * 2) / 3;
  const headerHeight = 68;
  const contentTop = padding + headerHeight;
  const contentHeight = output.height - contentTop - padding;

  canvases.slice(0, 3).forEach((rawSource, index) => {
    const source = cropCanvasToContent(rawSource);
    const x = padding + index * (columnWidth + gap);
    context.fillStyle = "#ffffff";
    context.fillRect(x, padding, columnWidth, headerHeight + contentHeight);
    context.fillStyle = "#313131";
    context.fillRect(x, padding, columnWidth, headerHeight);
    context.fillStyle = "#ffffff";
    context.font = "600 28px Arial, sans-serif";
    context.fillText(titles[index] ?? `第 ${index + 1} 班`, x + 22, padding + 43);

    const scale = Math.min((columnWidth - 12) / source.width, contentHeight / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    context.drawImage(source, x + (columnWidth - width) / 2, contentTop + (contentHeight - height) / 2, width, height);
  });
  return output;
}

export async function downloadCanvasImage(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Keep the URL alive while the browser starts saving the file.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function downloadScheduleImage(board: HTMLElement, fileName: string): Promise<void> {
  await downloadCanvasImage(await captureScheduleImage(board), fileName);
}
