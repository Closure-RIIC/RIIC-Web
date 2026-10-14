import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

export const adminPageClass = "mx-auto grid w-full min-w-0 max-w-[1440px] content-start gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8";

export function AdminPageHeader({ title, description, actions }: {
  title: "overview" | "users" | "issues" | "quality" | "skills" | "changelog" | "billing" | "agent";
  description: "overviewHint" | "usersHint" | "issuesHint" | "qualityHint" | "skillsHint" | "changelogHint" | "billingHint" | "agentHint";
  actions?: ReactNode;
}) {
  const t = useTranslations("AdminWorkspace");
  return <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{t(title)}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t(description)}</p>
    </div>
    {actions}
  </header>;
}
