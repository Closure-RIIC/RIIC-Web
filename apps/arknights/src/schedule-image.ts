const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_PIXELS = 16_000_000;

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

export async function captureScheduleImage(board: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas-pro");
  await document.fonts.ready;
  await waitForImages(board);

  return html2canvas(board, {
    backgroundColor: "#ffffff",
    logging: false,
    scale: scheduleImageScale(board.scrollWidth, board.scrollHeight),
    useCORS: true,
  });
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
