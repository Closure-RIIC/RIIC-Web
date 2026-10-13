import { workbenchPageFromPathname, type AppPage } from "./workbench-routes";

// Shared by page headings and portalled surfaces, which cannot inherit page CSS.
const CATEGORY_ACCENTS = {
  scheduling: "#FFD800",
  progression: "#B8F03A",
  skills: "#22BBFF",
  personal: "#C084FC",
  assistant: "#FFD800",
} as const;

const PAGE_CATEGORIES: Record<AppPage, keyof typeof CATEGORY_ACCENTS> = {
  calculator: "scheduling",
  manual: "scheduling",
  mower: "scheduling",
  training: "scheduling",
  "account-health": "progression",
  mastery: "progression",
  recruitment: "progression",
  inventory: "progression",
  gacha: "progression",
  "skill-query": "skills",
  skland: "personal",
  account: "personal",
  billing: "personal",
  settings: "personal",
  agent: "assistant",
};

export function workbenchPageAccent(page: AppPage): string {
  return CATEGORY_ACCENTS[PAGE_CATEGORIES[page]];
}

export function dialogAccentForPathname(pathname: string): string {
  return workbenchPageAccent(workbenchPageFromPathname(pathname));
}
