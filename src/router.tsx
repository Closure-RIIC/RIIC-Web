import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    scrollToTopSelectors: ["[data-app-scroll-area]"],
    defaultPreload: false,
  });
}

declare module "@tanstack/react-router" {
  interface Register { router: ReturnType<typeof getRouter>; }
}
