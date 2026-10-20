import { trackTelemetry } from "@/lib/telemetry-dispatch";

interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}

let activePage: { page: string; at: number } | null = null;
let clsValue = 0;
let longTaskDuration = 0;
let longTaskCount = 0;

function reportLongTasks(): void {
  if (!longTaskCount) return;
  trackTelemetry({type:"performance",name:"long_task_total",page:activePage?.page,
    durationMs:Math.round(longTaskDuration),meta:{count:longTaskCount}});
  longTaskCount=0;
  longTaskDuration=0;
}

function reportPage(final: boolean): void {
  reportLongTasks();
  const current = activePage;
  if (!current) return;
  if (clsValue > 0) {
    trackTelemetry({
      type: "performance",
      name: "web_vitals_cls",
      page: current.page,
      value: Math.round(clsValue * 1000),
    });
    clsValue = 0;
  }
  trackTelemetry({
    type: "interaction",
    name: "page_view",
    page: current.page,
    durationMs: Math.max(0, Date.now() - current.at),
  }, final);
  if (final) activePage = null;
}

export function trackTelemetryPage(pathname: string): void {
  if (activePage?.page === pathname) return;
  reportPage(false);
  activePage = { page: pathname, at: Date.now() };
}

/** Start global Web Vitals, long-task and page-duration observers. */
export function startTelemetryRuntime(pathname: string): () => void {
  trackTelemetryPage(pathname);
  const observers: PerformanceObserver[] = [];
  const trackVital = (name: string, durationMs?: number, value?: number) => {
    trackTelemetry({ type: "performance", name, page:activePage?.page, durationMs, value });
  };
  const observe = (type: string, callback: PerformanceObserverCallback) => {
    try {
      const observer = new PerformanceObserver(callback);
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // Unsupported browser performance entries are optional.
    }
  };

  observe("paint", (list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === "first-contentful-paint") trackVital("web_vitals_fcp", Math.round(entry.startTime));
    }
  });
  observe("largest-contentful-paint", (list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) trackVital("web_vitals_lcp", Math.round(last.startTime));
  });
  observe("layout-shift", (list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as LayoutShiftEntry;
      if (!shift.hadRecentInput) clsValue += shift.value;
    }
  });
  try {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) trackVital("web_vitals_ttfb", Math.round(navigation.responseStart - navigation.requestStart));
  } catch {
    // Navigation timing is optional.
  }
  observe("longtask", (list) => {
    for (const entry of list.getEntries()) { longTaskDuration+=entry.duration; longTaskCount++; }
  });
  const longTaskTimer = window.setInterval(reportLongTasks, 30_000);

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") reportPage(true);
    else trackTelemetryPage(window.location.pathname);
  };
  const onPageHide = () => reportPage(true);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    window.clearInterval(longTaskTimer);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observers.forEach((observer) => observer.disconnect());
    reportPage(true);
  };
}
