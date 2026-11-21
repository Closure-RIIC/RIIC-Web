"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import type { ArchiveTurn } from "@/server/agent/conversation-store";

interface Conversation { id: string; userId: string; title: string; updatedAt: string; turnCount: number }
interface Detail { conversation: Pick<Conversation, "id" | "title" | "userId">; turns: ArchiveTurn[]; next: string | null }
async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

export function AgentArchiveLink({ admin = false }: { admin?: boolean }) {
  const t = useTranslations("AgentArchive");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void read<{ canManageAll: boolean }>("/api/agent/archive?action=access", controller.signal)
      .then(access => setVisible(!admin || access.canManageAll)).catch(() => {});
    return () => controller.abort();
  }, [admin]);
  return visible ? <a className="inline-block px-4 py-2 text-xs text-primary underline underline-offset-4" href={admin ? "/admin/agent-archive" : "/agent-archive"}>{t(admin ? "adminTitle" : "title")}</a> : null;
}

export function AgentArchive({ admin = false }: { admin?: boolean }) {
  const t = useTranslations("AgentArchive");
  const [filters, setFilters] = useState({ userId: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<Conversation[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const selection = useRef(0);
  const params = useCallback((action: string, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ action, ...(admin ? { scope: "all" } : {}), ...extra });
    if (admin && applied.userId) query.set("userId", applied.userId.trim());
    if (applied.from) query.set("from", new Date(applied.from).toISOString());
    if (applied.to) query.set("to", new Date(applied.to).toISOString());
    return `/api/agent/archive?${query}`;
  }, [admin, applied]);
  useEffect(() => {
    const controller = new AbortController();
    selection.current++;
    setDetail(null); setItems([]); setNext(null); setError(""); setLoading(true); setAllowed(false); setCanExport(false);
    void Promise.all([read<{ items: Conversation[]; next: string | null }>(params("list"), controller.signal),
      read<{ canExport: boolean }>("/api/agent/archive?action=access", controller.signal)])
      .then(([data, access]) => { setItems(data.items); setNext(data.next); setAllowed(true); setCanExport(access.canExport); })
      .catch(cause => { if (!controller.signal.aborted) setError(String(cause.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params, revision]);
  const open = async (id: string, after?: string) => {
    const ticket = ++selection.current;
    setLoading(true); setError("");
    try {
      const data = await read<Detail>(params("detail", { id, ...(after ? { after } : {}) }));
      if (ticket === selection.current) setDetail(previous => ({ ...data, turns: after && previous?.conversation.id === id ? [...previous.turns, ...data.turns] : data.turns }));
    } catch (cause) { if (ticket === selection.current) setError((cause as Error).message); }
    finally { if (ticket === selection.current) setLoading(false); }
  };
  const more = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const data = await read<{ items: Conversation[]; next: string | null }>(params("list", { before: next }));
      setItems(previous => [...previous, ...data.items]); setNext(data.next);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const remove = async () => {
    if (!detail || admin || !window.confirm(t("deleteConfirm"))) return;
    setLoading(true);
    try {
      const response = await fetch(params("delete", { id: detail.conversation.id }), { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? t("failed"));
      setRevision(value => value + 1);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const download = (format: "json" | "jsonl", id?: string) => canExport ? <form method="POST" target="_blank" rel="noopener" action={params("export", { format, ...(id ? { id } : {}) })}>
    <Button type="submit" variant="outline" size="sm" disabled={!allowed || loading}>{t(id ? "exportConversation" : "exportAll", { format: format.toUpperCase() })}</Button>
  </form> : null;
  return <main id={admin ? "admin-content" : undefined} className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{t(admin ? "adminTitle" : "title")}</h1><a href={admin ? "/admin/agent" : "/agent"} className="text-sm text-primary underline">{t("back")}</a></div>
    <p className="text-sm text-muted-foreground">{t(admin ? "adminHint" : "hint")}</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setApplied({ ...filters }); }}>
      {admin ? <label className="grid gap-1 text-sm">{t("account")}<input className="rounded-md border bg-background p-2" value={filters.userId} onChange={event => setFilters({ ...filters, userId: event.target.value })} /></label> : null}
      <label className="grid gap-1 text-sm">{t("from")}<input type="datetime-local" className="rounded-md border bg-background p-2" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label>
      <label className="grid gap-1 text-sm">{t("to")}<input type="datetime-local" className="rounded-md border bg-background p-2" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label>
      <Button type="submit" disabled={loading}>{t("filter")}</Button><Button type="button" variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t("refresh")}</Button>
    </form>
    <div className="flex flex-wrap gap-2">{download("jsonl")}{download("json")}</div>
    {canExport ? <p className="text-xs text-muted-foreground">{t("exportHint")}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {loading ? <p role="status" className="text-sm">{t("loading")}</p> : null}
    <div className="grid gap-5 md:grid-cols-[17rem_1fr]">
      <nav aria-label={t("title")} className="space-y-2">
        {!loading && !items.length && !error ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
        {items.map(item => <button key={item.id} type="button" disabled={loading} aria-current={detail?.conversation.id === item.id ? "true" : undefined} className={`grid w-full gap-1 rounded-lg border p-3 text-left ${detail?.conversation.id === item.id ? "border-primary" : ""}`} onClick={() => void open(item.id)}>
          <span className="break-words text-sm font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleString()} · {t("turns", { count: item.turnCount })}</span>
          {admin ? <span className="break-all text-xs text-muted-foreground">{item.userId}</span> : null}
        </button>)}
        {next ? <Button variant="outline" disabled={loading} onClick={() => void more()}>{t("more")}</Button> : null}
      </nav>
      <section className="min-w-0 space-y-4" aria-label={t("detail")}>
        {detail ? <>
          <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto break-words font-semibold">{detail.conversation.title}</h2>{download("jsonl", detail.conversation.id)}{!admin ? <Button variant="destructive" size="sm" disabled={loading} onClick={() => void remove()}>{t("delete")}</Button> : null}</div>
          {detail.turns.map(turn => <article key={turn.id} className="space-y-3 rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">#{turn.sequence} · {turn.model} · {t(turn.status === "failed" ? "failedStatus" : turn.status)} · {new Date(turn.createdAt).toLocaleString()}</p>
            {[{ role: "user", message: turn.userMessage }, { role: "assistant", message: turn.assistantMessage }].map(({ role, message }) => <div key={role} className="space-y-2"><h3 className="text-sm font-semibold">{t(role as "user" | "assistant")}</h3>
              {message?.parts.map((part, index) => part.type === "text" ? <p key={index} className="whitespace-pre-wrap break-words text-sm">{part.text}</p> : <details key={index} className="text-xs"><summary className="cursor-pointer">{t("structuredPart")} · {part.type}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3">{JSON.stringify(part, null, 2)}</pre></details>)}
              {!message ? <p className="text-xs text-muted-foreground">{t("noReply")}</p> : null}
            </div>)}
          </article>)}
          {detail.next ? <Button variant="outline" disabled={loading} onClick={() => void open(detail.conversation.id, detail.next!)}>{t("more")}</Button> : null}
        </> : <p className="text-sm text-muted-foreground">{t("select")}</p>}
      </section>
    </div>
  </main>;
}
