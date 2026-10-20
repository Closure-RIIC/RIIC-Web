import type { OverlayScrollbars, PartialOptions } from "overlayscrollbars";

export type ScrollDirection = "x" | "y" | "both";

export function scrollbarOptions(direction: ScrollDirection): PartialOptions {
  return {
    overflow: { x: direction === "y" ? "hidden" : "scroll", y: direction === "x" ? "hidden" : "scroll" },
    scrollbars: {
      theme: "os-theme-yeye", autoHide: "leave", autoHideDelay: 600,
      autoHideSuspend: false, dragScroll: true, clickScroll: false,
    },
  };
}

export function isTouchViewport() {
  return window.matchMedia("(pointer: coarse)").matches ||
    (window.matchMedia("(max-width: 767px)").matches && navigator.maxTouchPoints > 0);
}

const selector = "[data-yeye-scroll]";

/** Enhance explicit scroll surfaces without moving their content. The existing
 * node remains the viewport for React refs, scroll events and Base UI navigation.
 */
export function observeScrollbars(create: typeof OverlayScrollbars) {
  const instances = new Map<HTMLElement, OverlayScrollbars>();
  const pending = new Set<HTMLElement>();
  let frame = 0;

  function destroy(element: HTMLElement) {
    instances.get(element)?.destroy();
    instances.delete(element);
  }

  function enhance(element: HTMLElement) {
    const slotId = element.dataset.yeyeScrollSlot;
    if (!element.isConnected || (isTouchViewport() && !slotId) || instances.has(element)) return;
    const slot = slotId ? document.getElementById(slotId) : null;
    if (slotId && !slot) return;
    const mode = element.dataset.yeyeScroll;
    if (mode === undefined) return;
    const styles = getComputedStyle(element);
    const x = /auto|scroll/.test(styles.overflowX);
    const y = /auto|scroll/.test(styles.overflowY);
    if (mode === "auto" && !x && !y) return;
    const direction = mode === "auto" ? (x && y ? "both" : x ? "x" : "y") : mode;
    if (direction !== "x" && direction !== "y" && direction !== "both") return;
    try {
      const instance = create({
        target: element,
        elements: { viewport: element },
        ...(slot ? { scrollbars: { slot }, cancel: { nativeScrollbarsOverlaid: false } } : {}),
      }, scrollbarOptions(direction));
      const { scrollbarHorizontal, scrollbarVertical } = instance.elements();
      for (const { scrollbar } of [scrollbarHorizontal, scrollbarVertical]) {
        scrollbar.setAttribute("aria-hidden", "true");
      }
      instances.set(element, instance);
      element.dispatchEvent(new Event("yeye-scrollbar-ready"));
    } catch {
      // Restore native scrolling if initialization failed partway through.
      create(element)?.destroy();
    }
  }

  function collect(node: Element) {
    if (node instanceof HTMLElement && node.matches(selector)) pending.add(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(element => pending.add(element));
    // A portal slot can mount after its viewport. Retry only the matching surface.
    const slots = [...node.querySelectorAll<HTMLElement>("[data-yeye-scroll-slot-host]")];
    if (node instanceof HTMLElement && node.hasAttribute("data-yeye-scroll-slot-host")) slots.push(node);
    for (const slot of slots) {
      document.querySelectorAll<HTMLElement>(selector).forEach(element => {
        if (element.dataset.yeyeScrollSlot === slot.id) pending.add(element);
      });
    }
  }

  function flush() {
    frame = 0;
    for (const element of instances.keys()) {
      if (!element.isConnected || !element.matches(selector)) destroy(element);
    }
    for (const element of pending) enhance(element);
    pending.clear();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(flush);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") {
        const element = record.target as HTMLElement;
        if (element.matches(selector) || instances.has(element)) {
          destroy(element);
          pending.add(element);
        }
      } else {
        record.addedNodes.forEach(node => { if (node instanceof Element) collect(node); });
      }
    }
    schedule();
  });

  function refresh() {
    for (const element of instances.keys()) destroy(element);
    collect(document.body);
    schedule();
  }

  const coarse = window.matchMedia("(pointer: coarse)");
  const narrow = window.matchMedia("(max-width: 767px)");
  coarse.addEventListener("change", refresh);
  narrow.addEventListener("change", refresh);
  observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-yeye-scroll", "data-yeye-scroll-slot", "class"],
  });
  collect(document.body);
  flush();

  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    coarse.removeEventListener("change", refresh);
    narrow.removeEventListener("change", refresh);
    for (const element of instances.keys()) destroy(element);
    pending.clear();
  };
}
