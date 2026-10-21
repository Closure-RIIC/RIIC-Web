import { flushSync } from "react-dom";

let activeTransition: ViewTransition | undefined;
let requestId = 0;

/** Capture only this board's visible rooms; the rest of the page stays live. */
export async function transitionScheduleLayout(board: HTMLElement, mode: "list" | "compact", update: () => void): Promise<void> {
  const request = ++requestId;
  if (activeTransition) {
    activeTransition.skipTransition();
    await activeTransition.finished.catch(() => {});
  }
  if (request !== requestId || !board.isConnected) return;

  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }

  const root = document.documentElement;
  const names = new Map<string, string>();
  const namedElements: HTMLElement[] = [];
  const widthAnimations: Animation[] = [];
  const previousAnchor = board.style.overflowAnchor;
  let scrollContainer = board.parentElement;
  while (scrollContainer && !/(auto|scroll)/.test(getComputedStyle(scrollContainer).overflowY)) {
    scrollContainer = scrollContainer.parentElement;
  }
  const scroller = scrollContainer ?? document.scrollingElement;
  const scrollTop = scroller?.scrollTop ?? 0;

  function nameVisibleRooms(incoming = false) {
    // Read geometry in one batch before assigning snapshot names.
    const visibleRooms = [...board.querySelectorAll<HTMLElement>("[data-schedule-room]")].filter(room => {
      const rect = room.getBoundingClientRect();
      // Do not send offscreen rooms flying through the visible part of the page.
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= innerHeight;
    });
    for (const room of visibleRooms) {
      const key = room.dataset.scheduleRoom!;
      let name = names.get(key);
      if (incoming && mode === "compact") {
        // Existing cards keep a continuous surface as they contract. Rooms that
        // were below the list viewport enter after those cards have made space.
        room.style.setProperty("view-transition-class", name ? "schedule-room-returning" : "schedule-room-entering");
      }
      if (!name) {
        name = `schedule-room-${request}-${names.size}`;
        names.set(key, name);
      }
      room.style.viewTransitionName = name;
      namedElements.push(room);
    }
  }

  board.style.overflowAnchor = "none";
  root.classList.add("schedule-layout-transition");
  if (mode === "compact") root.classList.add("schedule-layout-return");
  nameVisibleRooms();
  const transition = document.startViewTransition(() => {
    if (!board.isConnected) return;
    // The old snapshot is already captured. Do not retain named layers in the
    // detached cache while the browser prepares the incoming snapshot.
    for (const room of namedElements) room.style.removeProperty("view-transition-name");
    // Both trees must be captured in their final layout, without an exit delay.
    flushSync(update);
    if (scroller) scroller.scrollTop = scrollTop;
    nameVisibleRooms(true);
  });
  activeTransition = transition;
  const skip = () => transition.skipTransition();
  window.addEventListener("resize", skip, { once: true });
  // A skipped/unsupported snapshot must never prevent the requested state update.
  void transition.ready.then(() => {
    if (mode !== "compact" || activeTransition !== transition) return;
    const roomGroups = new Set([...names.values()].map(name => `::view-transition-group(${name})`));
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || !roomGroups.has(effect.pseudoElement ?? "")) continue;
      const frames = effect.getKeyframes();
      const first = frames[0];
      const last = frames.at(-1);
      if (!first?.width || !last?.width || parseFloat(String(first.width)) <= parseFloat(String(last.width))) continue;
      // Contract before settling into the neighboring column, so wide list
      // cards do not sweep over the other compact rooms. Keep the same lifetime
      // as the native group; this only overrides its snapshot width.
      const contraction = root.animate([
        { width: first.width },
        { width: last.width, offset: 0.6 },
        { width: last.width },
      ], { duration: 360, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)", fill: "both", pseudoElement: effect.pseudoElement });
      if (animation.startTime !== null) contraction.startTime = animation.startTime;
      widthAnimations.push(contraction);
    }
  }).catch(() => {});
  try {
    await transition.finished;
  } finally {
    // Discard any width overrides along with the native snapshot animations.
    for (const animation of widthAnimations) animation.cancel();
    window.removeEventListener("resize", skip);
    for (const room of namedElements) {
      room.style.removeProperty("view-transition-name");
      room.style.removeProperty("view-transition-class");
    }
    board.style.overflowAnchor = previousAnchor;
    root.classList.remove("schedule-layout-transition", "schedule-layout-return");
    if (activeTransition === transition) activeTransition = undefined;
  }
}
