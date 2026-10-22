const importSteps = ["open-settings", "change-box", "choose-source-in-app", "import-methods", "finish"];
const issueArticles: Record<string, string> = {
  "unexpected-operators": "faq-box", "saved-box": "faq-saved-box", "box-not-applied": "faq-box-not-applied", busy: "faq-busy",
};

export function legacyImportDestination(search: Record<string, unknown>): { slug: string; hash: string; source?: "maa" | "skland" } {
  const step = Number.parseInt(String(search.step ?? "1"), 10);
  const index = Number.isFinite(step) ? Math.max(0, Math.min(importSteps.length - 1, step - 1)) : 0;
  const source = search.source === "maa" || search.source === "skland" ? search.source : undefined;
  return { slug: "first-import", hash: importSteps[index], source };
}

export const legacyIssueDestination = (issue: unknown) => typeof issue === "string" && Object.hasOwn(issueArticles, issue) ? issueArticles[issue] : "faq";
