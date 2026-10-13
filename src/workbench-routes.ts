export type AppPage = "calculator" | "manual" | "mower" | "training" | "mastery" | "recruitment" | "inventory" | "gacha" | "skill-query" | "skland" | "account" | "account-health" | "settings" | "billing" | "agent";

export const SKLAND_TABS = ["overview", "inventory", "infrastructure"] as const;
export type SklandTab = typeof SKLAND_TABS[number];

export function isSklandTab(value: unknown): value is SklandTab {
  return SKLAND_TABS.some((tab) => tab === value);
}

export function sklandTabFromPathname(pathname: string): SklandTab | null {
  if (pathname === "/skland") return "overview";
  const segments = pathname.split("/");
  return segments.length === 3 && segments[1] === "skland" && isSklandTab(segments[2])
    ? segments[2]
    : null;
}

export function sklandTabHref(tab: SklandTab): string {
  return tab === "overview" ? "/skland" : `/skland/${tab}`;
}

export const WORKBENCH_PAGE_PATHS: Record<AppPage, string> = {
  calculator: "/",
  manual: "/manual",
  mower: "/mower",
  training: "/training",
  mastery: "/mastery",
  recruitment: "/recruitment",
  inventory: "/inventory",
  gacha: "/gacha",
  "skill-query": "/skills",
  skland: "/skland",
  account: "/account",
  billing: "/billing",
  agent: "/agent",
  "account-health": "/account-health",
  settings: "/settings",
};

export function workbenchPageFromPathname(pathname: string): AppPage {
  if (pathname === WORKBENCH_PAGE_PATHS.manual) return "manual";
  if (pathname === WORKBENCH_PAGE_PATHS.mower) return "mower";
  if (pathname === WORKBENCH_PAGE_PATHS.training) return "training";
  if (pathname === WORKBENCH_PAGE_PATHS.mastery) return "mastery";
  if (pathname === WORKBENCH_PAGE_PATHS.recruitment) return "recruitment";
  if (pathname === WORKBENCH_PAGE_PATHS.inventory) return "inventory";
  if (pathname === WORKBENCH_PAGE_PATHS.gacha) return "gacha";
  if (pathname === WORKBENCH_PAGE_PATHS["skill-query"]) return "skill-query";
  if (pathname === WORKBENCH_PAGE_PATHS.skland || sklandTabFromPathname(pathname)) return "skland";
  if (pathname === WORKBENCH_PAGE_PATHS.account) return "account";
  if (pathname === WORKBENCH_PAGE_PATHS.billing) return "billing";
  if (pathname === WORKBENCH_PAGE_PATHS.agent) return "agent";
  if (pathname === WORKBENCH_PAGE_PATHS["account-health"]) return "account-health";
  if (pathname === WORKBENCH_PAGE_PATHS.settings) return "settings";
  return "calculator";
}

export function workbenchHref(page: AppPage): string {
  return WORKBENCH_PAGE_PATHS[page];
}
