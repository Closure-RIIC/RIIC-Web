function prepareStripedBackground(element: HTMLElement) {
  const styles = element.ownerDocument.defaultView!.getComputedStyle(element);
  if (!styles.backgroundImage.startsWith("repeating-linear-gradient(135deg,")) return;
  const stops = Array.from(styles.backgroundImage.matchAll(/([\w-]+\([^()]*\))\s+([\d.]+)px/g), match => ({ color: match[1], offset: Number(match[2]) }));
  const period = stops.at(-1)?.offset;
  const { width, height } = element.getBoundingClientRect();
  if (!period || !width || !height) return;
  const startX = (width - height) / 4;
  const startY = (height - width) / 4;
  const endX = startX + period / Math.SQRT2;
  const endY = startY + period / Math.SQRT2;
  const saturation = styles.filter.match(/^saturate\(([\d.]+)\)$/)?.[1] ?? "1";
  const gradientStops = stops.map(stop => `<stop offset="${stop.offset / period}" stop-color="${stop.color}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="stripes" gradientUnits="userSpaceOnUse" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" spreadMethod="repeat">${gradientStops}</linearGradient><filter id="saturation" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="${saturation}"/></filter></defs><g filter="url(#saturation)"><rect width="100%" height="100%" fill="${styles.backgroundColor}"/><rect width="100%" height="100%" fill="url(#stripes)"/></g></svg>`;
  element.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  element.style.backgroundSize = "100% 100%";
  element.style.backgroundRepeat = "no-repeat";
  element.style.filter = "none";
}

function prepareScreenshotDocument(clonedDocument: Document) {
  for (const bar of clonedDocument.querySelectorAll<HTMLElement>("[data-gacha-draw-bar]")) {
    prepareStripedBackground(bar);
    const fill = bar.querySelector<HTMLElement>(':scope > [aria-hidden="true"]');
    if (!fill) continue;
    prepareStripedBackground(fill);
    const cutProbe = clonedDocument.createElement("div");
    cutProbe.style.cssText = "position:absolute;visibility:hidden;width:var(--gacha-bar-cut);height:0";
    bar.append(cutProbe);
    const cutWidth = cutProbe.getBoundingClientRect().width;
    cutProbe.remove();
    fill.style.clipPath = `polygon(0 0, 100% 0, ${fill.getBoundingClientRect().width - cutWidth}px 100%, 0 100%)`;
  }
  for (const laurel of clonedDocument.querySelectorAll<SVGSVGElement>("[data-gacha-rating] svg[data-mirrored]")) {
    const group = clonedDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    const viewBox = laurel.viewBox.baseVal;
    group.setAttribute("transform", `translate(${2 * viewBox.x + viewBox.width} 0) scale(-1 1)`);
    group.append(...laurel.childNodes);
    laurel.append(group);
    laurel.style.transform = "none";
  }
}

export async function captureGachaScreenshot(): Promise<File> {
  const { default: html2canvas } = await import("html2canvas-pro");
  await document.fonts.ready;
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const canvas = await html2canvas(document.documentElement, {
    x: window.scrollX + (viewport?.offsetLeft ?? 0),
    y: window.scrollY + (viewport?.offsetTop ?? 0),
    width,
    height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    useCORS: true,
    logging: false,
    imageTimeout: 8_000,
    onclone: prepareScreenshotDocument,
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png");
  });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new File([blob], "riic-gacha-" + timestamp + ".png", { type: "image/png" });
}

export function canShareScreenshot(file: File): boolean {
  try {
    return window.isSecureContext && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
