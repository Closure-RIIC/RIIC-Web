import type { ComponentType } from "react";
import { PageScrollbar } from "./page-scrollbar";

/** Mount within the page's lazy route boundary, after its SSR DOM hydrates.
 * Root effects can run while a child route is still dehydrated; enhancing that
 * DOM early inserts scrollbar nodes that React mistakes for server mismatches.
 */
export function withPageScrollbars(Component: ComponentType) {
  return function HydratedPage() {
    return <><Component /><PageScrollbar /></>;
  };
}
