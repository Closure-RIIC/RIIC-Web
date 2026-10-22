import { useMemo } from "react";
import { notFound as routeNotFound, useLocation, useRouter as useTanStackRouter, useRouterState, type AnyRouter } from "@tanstack/react-router";
import { createIntentPreloader, permitsPreload } from "./route-preload";

const preloaders = new WeakMap<AnyRouter, ReturnType<typeof createIntentPreloader>>();
function codePreloader(router: AnyRouter) {
  let preloader = preloaders.get(router);
  if (!preloader) {
    preloader = createIntentPreloader(async (href) => {
      // Only route code: never run beforeLoad, loaders or authentication speculatively.
      const [routes] = router.getMatchedRoutes(href);
      await Promise.all(routes.map(route => router.loadRouteChunk(route)));
    }, () => typeof navigator !== "undefined" && document.visibilityState === "visible"
      && router.state.status === "idle"
      && permitsPreload((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection));
    router.subscribe("onBeforeNavigate", () => preloader!.cancel());
    preloaders.set(router, preloader);
  }
  return preloader;
}

export function notFound(): never { throw routeNotFound(); }
export function usePathname() { return useLocation({ select: (location) => location.pathname }); }
/** Keep the workbench's mode and selected navigation aligned with its rendered page. */
export function useRenderedPathname() {
  return useRouterState({ select: (state) => state.matches.at(-1)?.pathname ?? state.location.pathname });
}
export function useSearchParams() {
  const search = useLocation({ select: (location) => location.searchStr });
  return useMemo(() => new URLSearchParams(search), [search]);
}
/** URL-based navigation for existing workbench actions and query filters. */
export function useRouter() {
  const router = useTanStackRouter();
  return useMemo(() => ({
    push: (href: string, options?: { scroll?: boolean }) => router.navigate({ href, resetScroll: options?.scroll !== false }),
    replace: (href: string, options?: { scroll?: boolean }) => router.navigate({ href, replace: true, resetScroll: options?.scroll !== false }),
    prefetch: (href: string) => codePreloader(router).schedule(href),
    cancelPrefetch: (href: string) => codePreloader(router).cancel(href),
    refresh: () => router.invalidate(),
    back: () => router.history.back(),
  }), [router]);
}
