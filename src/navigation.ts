import { useMemo } from "react";
import { notFound as routeNotFound, useLocation, useRouter as useTanStackRouter } from "@tanstack/react-router";

export function notFound(): never { throw routeNotFound(); }
export function usePathname() { return useLocation({ select: (location) => location.pathname }); }
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
    prefetch: (href: string) => router.preloadRoute({ to: href }),
    refresh: () => router.invalidate(),
    back: () => router.history.back(),
  }), [router]);
}
