"use client";

import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type IssueMessages from "../../../messages/zh-CN/HelpIssues.json";
const issueText = createLocalizer<typeof IssueMessages>("HelpIssues");
import { useTranslations, useLocale } from "use-intl";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type IssueId = "unexpected-operators" | "saved-box" | "box-not-applied" | "busy";

const issues = [{ id: "unexpected-operators" as const, title: "unexpected-operatorsTitle" as const, body: null },
{ id: "saved-box" as const, title: "saved-boxTitle" as const, body: "saved-boxBody" as const },
{ id: "box-not-applied" as const, title: "box-not-appliedTitle" as const, body: "box-not-appliedBody" as const },
{ id: "busy" as const, title: "busyTitle" as const, body: "busyBody" as const }];

function parseIssue(value: string | null): IssueId | null {
  return issues.some((issue) => issue.id === value) ? value as IssueId : null;
}

export function IssueSolutionPicker({ children }: { children: ReactNode }) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const [selected, setSelected] = useState<IssueId | null>(null);

  useEffect(() => {
    const sync = () => setSelected(parseIssue(new URL(window.location.href).searchParams.get("issue")));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function selectIssue(id: IssueId) {
    setSelected(id);
    const url = new URL(window.location.href);
    url.searchParams.set("issue", id);
    window.history.replaceState({}, "", url);
  }

  const issue = issues.find((item) => item.id === selected);

  return (
    <section className="grid gap-5" data-help-issue-picker>
      <fieldset className="grid gap-4 rounded-[4px] border border-border bg-card p-4 sm:p-5">
        <legend className="px-1 text-lg font-semibold">{intl("components_help_IssueSolutionPicker.whatProblemAreYouSeeing")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {issues.map((item) => (
            <label className={cn("cursor-pointer rounded-[4px] border border-border p-3 text-sm font-semibold transition-colors hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", selected === item.id && "border-foreground bg-foreground text-background")} key={item.id}>
              <input checked={selected === item.id} className="sr-only" name="help-issue" onChange={() => selectIssue(item.id)} type="radio" value={item.id} />
              {issueText.text(en, item.title)}
            </label>
          ))}
        </div>
      </fieldset>

      {selected === "unexpected-operators" ? children : null}
      {issue && selected !== "unexpected-operators" ? <section className="rounded-[4px] border border-border bg-card p-5 text-sm leading-6" data-help-issue-solution>{issue.body ? <p>{issueText.text(en, issue.body)}</p> : null}</section> : null}
      {!selected ? <p className="rounded-[4px] border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">{intl("components_help_IssueSolutionPicker.chooseAProblemToViewItsSolution")}</p> : null}
    </section>
  );
}
