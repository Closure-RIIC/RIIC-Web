import { useEffect, useState } from "react";
import { useWorkspace } from "../state";

/** A separate notice surface keeps facility edits independent from transient UI. */
export function FacilityCompletionNotice() {
  const { t } = useWorkspace();
  const [completion, setCompletion] = useState(0);
  useEffect(() => {
    const show = () => setCompletion(value => value + 1);
    window.addEventListener("riic:endfield:facilities-completed", show);
    return () => window.removeEventListener("riic:endfield:facilities-completed", show);
  }, []);
  useEffect(() => {
    if (!completion) return;
    const timer = setTimeout(() => setCompletion(0), 3000);
    return () => clearTimeout(timer);
  }, [completion]);
  if (!completion) return null;
  return <aside role="status" aria-live="polite" className="fixed right-3 bottom-20 z-50 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-background p-4 text-sm shadow-lg">
    <strong>{t("基建设施已补全", "Facilities completed")}</strong>
    <p className="mt-1 text-muted-foreground">{t("缺失设施已按默认等级补全，仅用于本地模拟；已有等级已保留。", "Missing facilities use default levels for local simulation. Existing levels are preserved.")}</p>
    <button type="button" className="mt-2 underline" onClick={() => setCompletion(0)}>{t("关闭", "Dismiss")}</button>
  </aside>;
}
