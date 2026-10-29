"use client";
import { useRef } from "react";


import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { DIAGNOSTIC_CATEGORIES, type DiagnosticReport } from "@riic/arknights-domain/diagnostics";
import { useAdminRequest } from "./admin-context";

export function DiagnosticsPanel() {
  const requestAdminData = useAdminRequest();
  const t=useTranslations("diagnostics");
  // Language changes update copy without reloading or overwriting in-progress work.
  const languageEffectRef = useRef({ t });
  useEffect(() => { languageEffectRef.current = { t }; }, [t]);
  const locale=useLocale();
  const [hours,setHours]=useState("1");
  const [category,setCategory]=useState("all");
  const [report,setReport]=useState<DiagnosticReport|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true); setError(""); setReport(null);
    void requestAdminData<DiagnosticReport>(`/api/admin/diagnostics?hours=${hours}`,{signal:controller.signal},languageEffectRef.current.t("loadFailed"))
      .then(value=>{if(!controller.signal.aborted) setReport(value);})
      .catch(cause=>{if(!controller.signal.aborted) setError(cause instanceof Error ? cause.message : languageEffectRef.current.t("loadFailed"));})
      .finally(()=>{if(!controller.signal.aborted) setLoading(false);});
    return ()=>controller.abort();
  },[hours, refresh, requestAdminData]);
  const time=(value:string)=>new Intl.DateTimeFormat(locale,{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Shanghai",hour12:false}).format(new Date(value));
  const groups=report?.groups.filter(group=>category==="all" || group.category===category) ?? [];
  const recent=report?.recent.filter(row=>category==="all" || row.category===category) ?? [];
  return <section aria-labelledby="diagnostics-title" className="min-w-0 rounded-xl border bg-background p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><h2 id="diagnostics-title" className="text-xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p></div>
      <Button variant="outline" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>{t("refresh")}</Button>
    </div>
    <div className="my-4 flex flex-wrap gap-4">
      <label className="grid gap-1 text-sm">{t("window")}<select className="rounded-md border bg-background px-3 py-2" value={hours} onChange={event=>setHours(event.target.value)}><option value="1">{t("hour")}</option><option value="24">{t("day")}</option></select></label>
      <label className="grid gap-1 text-sm">{t("category")}<select className="rounded-md border bg-background px-3 py-2" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">{t("all")}</option>{DIAGNOSTIC_CATEGORIES.map(value=><option key={value} value={value}>{t(`categories.${value}`)}</option>)}</select></label>
    </div>
    {loading && <p role="status" className="text-sm">{t("loading")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {report && <>
      <p className="text-sm text-muted-foreground"><span className="font-number">{time(report.from)}–{time(report.to)}</span> · {t("timezone")} · {t("occurrences")} <span className="font-number">{report.total}</span> · {t("groups")} <span className="font-number">{report.groups.length}</span></p>
      {!report.configured && <p role="alert" className="mt-3 text-sm">{t("unconfigured")}</p>}
      {report.truncated && <p role="alert" className="mt-3 text-sm">{t("truncated")}</p>}
      <div data-yeye-scroll="auto" className="mt-4 max-h-[32rem] overflow-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-left text-sm"><thead className="sticky top-0 bg-muted"><tr>{(["category","code","route","reason","count"] as const).map(key=><th key={key} scope="col" className="p-3 font-medium">{t(key)}</th>)}</tr></thead>
          <tbody>{groups.map(group=><tr key={group.fingerprint} className="border-t align-top"><td className="p-3">{t(`categories.${group.category}`)}</td><td className="p-3 font-number">{group.code}</td><td className="max-w-52 break-all p-3"><span className="font-mono">{group.method} {group.route}</span></td><td className="max-w-md break-words p-3">{group.reason}</td><td className="p-3 font-number">{group.count}</td></tr>)}</tbody>
        </table>{!groups.length && <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>}
      </div>
      <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">{t("recent")}</summary><p className="mt-2 text-sm text-muted-foreground">{t("recentHint")}</p><div data-yeye-scroll="auto" className="mt-3 grid max-h-96 gap-3 overflow-auto">{recent.map((row,index)=><article key={`${row.requestId}-${index}`} className="min-w-0 rounded-lg border p-3 text-xs leading-5">
        <p className="font-number">{time(row.at)} · {row.code} · {row.status} · {row.durationMs} ms</p>
        <p className="break-all font-mono">requestId: {row.requestId}{row.diagnosticId ? ` · diagnosticId: ${row.diagnosticId}` : ""}</p>
        <p className="break-all font-mono">release: {row.release} · client: {row.clientVersion} · schema: {row.clientSchema}</p>
        <p className="break-words">{row.reason}</p>{row.fields.map((field,index)=><p key={index} className="break-words">{field.path}: {field.code} · {field.message}</p>)}
        {row.causes.map((cause,index)=><p key={index} className="break-words">{cause}</p>)}
      </article>)}</div></details>
    </>}
  </section>;
}
