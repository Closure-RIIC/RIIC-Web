"use client";
import { useTranslations, useLocale } from "use-intl";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type IssueId = "unexpected-operators" | "saved-box" | "box-not-applied" | "busy";

const issues: Array<{ id: IssueId; zh: [string, ReactNode]; en: [string, ReactNode] }> = [
  { id: "unexpected-operators", zh: ["结果里有我没有的干员", null], en: ["The result includes operators I do not own", null] },
  { id: "saved-box", zh: ["配置弹窗直接到了第 2 步", <p key="zh">浏览器已保存过 Box。点弹窗顶部第 1 步「干员数据」，即可回到数据来源选择。</p>], en: ["The setup dialog opens at step 2", <p key="en">A Box is already saved in this browser. Select step 1, “Operator Data”, at the top of the dialog to return to source selection.</p>] },
  { id: "box-not-applied", zh: ["换过 Box，结果却没变化", <p key="zh">确认当前数据不再是全精二示例，点「完成」保存后回到计算器重新生成；旧方案不会自动更新。</p>], en: ["I changed the Box, but the result did not change", <p key="en">Make sure the current data is no longer the max-level sample. Select “Finish”, return to the calculator, and generate again. Existing results do not update automatically.</p>] },
  { id: "busy", zh: ["提示请求过多或并发已满", <p key="zh">停止连续点击，按提示等待；仍繁忙时换一个时间段。已导入的 Box 会保存在浏览器，不用重新导入。</p>], en: ["Too many requests or concurrency limit reached", <p key="en">Stop clicking repeatedly and wait as instructed. If the service remains busy, try again later. Your imported Box stays in the browser.</p>] },
];

function parseIssue(value: string | null): IssueId | null {
  return issues.some((issue) => issue.id === value) ? value as IssueId : null;
}

export function IssueSolutionPicker({ children }: { children: ReactNode }) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
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
              {(en ? item.en : item.zh)[0]}
            </label>
          ))}
        </div>
      </fieldset>

      {selected === "unexpected-operators" ? children : null}
      {issue && selected !== "unexpected-operators" ? <section className="rounded-[4px] border border-border bg-card p-5 text-sm leading-6" data-help-issue-solution>{(en ? issue.en : issue.zh)[1]}</section> : null}
      {!selected ? <p className="rounded-[4px] border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">{intl("components_help_IssueSolutionPicker.chooseAProblemToViewItsSolution")}</p> : null}
    </section>
  );
}
