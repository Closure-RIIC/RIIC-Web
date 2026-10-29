"use client";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type AdminMessages from "../../../../messages/zh-CN/Admin_resources_console.json";
const adminText = createLocalizer<typeof AdminMessages>("Admin_resources_console");

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUILTIN_AGENT_PERSONAS } from "@/agent-personas";
import type { AgentResourcePolicy } from "@/server/agent/resource-policy";
import { useAdminRequest } from "../admin-context";

type Version = { id: string; version: number; status: "active" | "draft" | "retired"; created_at: string };
type State = { versions: Version[]; active: { id: string; payload: AgentResourcePolicy } | null };
const endpoint = "/api/admin/agent/resources";
const textareaClass = "min-h-72 w-full rounded-md border bg-background p-3 font-mono text-sm leading-relaxed";

export function AgentResourcesConsole() {
  const locale = useLocale();
  const request = useAdminRequest();
  const [state, setState] = useState<State | null>(null);
  const [payload, setPayload] = useState<AgentResourcePolicy | null>(null);
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState("prompt");
  const [document, setDocument] = useState("");
  const [skill, setSkill] = useState("");
  const [persona, setPersona] = useState("default");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const next = await request<State>(endpoint);
    if (mounted.current) setState(next);
    return next;
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    void load().then(next => {
      if (!mounted.current) return;
      setPayload(next.active?.payload ?? null); setSelected(next.active?.id);
    }).catch(error => { if (mounted.current) setError(String(error.message)); });
    return () => { mounted.current = false; };
  }, [load]);
  function edit(next: AgentResourcePolicy) { setPayload(next); setDirty(true); setNotice(""); }
  async function action(operation: "import" | "draft" | "publish" | "rollback", id = selected) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ id?: string; payload?: AgentResourcePolicy }>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: operation, id, payload: operation === "draft" ? payload : undefined, reason, expectedActive: state?.active?.id }) });
      if (operation === "import") {
        setPayload(result.payload!); setSelected(undefined); setDirty(true);
        setNotice(adminText.text(locale, "importedIntoTheEditorSaveADraftAnd"));
      } else {
        const next = await load();
        setSelected(result.id); setDirty(false);
        if (operation !== "draft") setPayload(next.active!.payload);
        setNotice(operation === "draft" ? adminText.text(locale, "draftSavedNotActiveYet") : adminText.text(locale, "publishedTheNextRequestUsesThisVersion"));
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError("");
    try {
      const result = await request<{ id: string; payload: AgentResourcePolicy }>(`${endpoint}?id=${encodeURIComponent(id)}`);
      setPayload(result.payload); setSelected(id); setDirty(false); setDocument(""); setSkill("");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const selectedVersion = state?.versions.find(item => item.id === selected);
  const selectedDoc = payload?.knowledge.files.find(item => item.path === document);
  const selectedSkill = payload?.skills.find(item => item.id === skill);
  const selectedPersona = payload?.personas.find(item => item.id === persona);
  const canPublish = !busy && !dirty && !!reason.trim() && selectedVersion?.status === "draft";
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6" aria-label={adminText.text(locale, "agentResources")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">{adminText.text(locale, "personasPromptsAndKnowledge")}</h2><p className="mt-1 text-sm text-muted-foreground">{adminText.text(locale, "eachRequestUsesOneResourceVersionSharedAcross")}</p></div>
      <Button variant="outline" disabled={busy || dirty} onClick={() => void action("import")}>{adminText.text(locale, "importServerResources")}</Button>
    </div>
    <p className="text-sm">{adminText.text(locale, "active")}: <strong>{state?.active?.id ?? adminText.text(locale, "configuredServerFiles")}</strong>{dirty && <span className="ml-3 text-muted-foreground">{adminText.text(locale, "unsavedChanges")}</span>}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!payload && <p className="text-sm text-muted-foreground">{adminText.text(locale, "importExistingResourcesToCreateTheFirstDraft")}</p>}
    {payload && <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2" aria-label={adminText.text(locale, "resourceCategories")}>
        {(["prompt", "persona", "knowledge", "skills"] as const).map(id => <Button key={id} variant={tab === id ? "default" : "outline"} aria-pressed={tab === id} onClick={() => setTab(id)}>{adminText.text(locale, id)}</Button>)}
      </div>
      {tab === "prompt" && <Label className="block space-y-2">{adminText.text(locale, "sharedSystemPrompt")}<Textarea aria-label={adminText.text(locale, "sharedSystemPrompt")} className={textareaClass} value={payload.systemPrompt} onChange={event => edit({ ...payload, systemPrompt: event.target.value })} /><span className="block text-xs text-muted-foreground">{adminText.text(locale, "theServerAddsSharedLanguageProtocolIsolationAnd")}</span></Label>}
      {tab === "persona" && <div className="space-y-3">
        <Label>{adminText.text(locale, "choosePersona")}<select className="h-9 max-w-full rounded-md border bg-background px-2" aria-label={adminText.text(locale, "choosePersona")} value={persona} onChange={event => setPersona(event.target.value)}><option value="default">{adminText.text(locale, "defaultAssistant")}</option>{payload.personas.map(card => <option key={card.id} value={card.id}>{BUILTIN_AGENT_PERSONAS.find(item => item.id === card.id)?.name ?? card.id}</option>)}</select></Label>
        {persona !== "default" && selectedPersona && <Label><input type="checkbox" checked={selectedPersona.enabled} onChange={event => edit({ ...payload, personas: payload.personas.map(item => item.id === persona ? { ...item, enabled: event.target.checked } : item) })} />{adminText.text(locale, "enableThisPersona")}</Label>}
        <Label className="block space-y-2">{adminText.text(locale, "personaContent")}<Textarea className={textareaClass} value={persona === "default" ? payload.defaultPersona : selectedPersona?.content ?? ""} onChange={event => edit(persona === "default" ? { ...payload, defaultPersona: event.target.value } : { ...payload, personas: payload.personas.map(item => item.id === persona ? { ...item, content: event.target.value } : item) })} /></Label>
      </div>}
      {tab === "knowledge" && <div className="space-y-3">
        <Label>{adminText.text(locale, "knowledgeVersionLabel")}<Input value={payload.knowledge.version} onChange={event => edit({ ...payload, knowledge: { ...payload.knowledge, version: event.target.value } })} /></Label>
        <Label className="block space-y-2">{adminText.text(locale, "sharedKnowledgeRules")}<Textarea className={textareaClass} value={payload.knowledge.policy} onChange={event => edit({ ...payload, knowledge: { ...payload.knowledge, policy: event.target.value } })} /></Label>
        <Label>{adminText.text(locale, "documentsAndIndexes")}<select className="h-9 w-full min-w-0 rounded-md border bg-background px-2" aria-label={adminText.text(locale, "documentsAndIndexes")} value={document} onChange={event => setDocument(event.target.value)}><option value="">{adminText.text(locale, "chooseAFile")} ({payload.knowledge.files.length})</option>{payload.knowledge.files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select></Label>
        {selectedDoc && <Label className="block space-y-2">{adminText.text(locale, "documentContent")}<Textarea className={textareaClass} value={selectedDoc.content} onChange={event => edit({ ...payload, knowledge: { ...payload.knowledge, files: payload.knowledge.files.map(file => file.path === document ? { ...file, content: event.target.value } : file) } })} /></Label>}
      </div>}
      {tab === "skills" && <div className="space-y-3">
        <Label>{adminText.text(locale, "chooseASkill")}<select className="h-9 max-w-full rounded-md border bg-background px-2" aria-label={adminText.text(locale, "chooseASkill")} value={skill} onChange={event => setSkill(event.target.value)}><option value="">{adminText.text(locale, "chooseASkill2")}</option>{payload.skills.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Label>
        {selectedSkill && <><Label><input type="checkbox" checked={selectedSkill.enabled} onChange={event => edit({ ...payload, skills: payload.skills.map(item => item.id === skill ? { ...item, enabled: event.target.checked } : item) })} />{adminText.text(locale, "enableThisSkill")}</Label>
          <Label>{adminText.text(locale, "purpose")}<Input value={selectedSkill.purpose} onChange={event => edit({ ...payload, skills: payload.skills.map(item => item.id === skill ? { ...item, purpose: event.target.value } : item) })} /></Label>
          <Label className="block space-y-2">{adminText.text(locale, "skillContent")}<Textarea className={textareaClass} value={selectedSkill.content} onChange={event => edit({ ...payload, skills: payload.skills.map(item => item.id === skill ? { ...item, content: event.target.value } : item) })} /></Label></>}
      </div>}
      <Label>{adminText.text(locale, "reasonForChange")}<Input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></Label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !reason.trim()} onClick={() => void action("draft")}>{adminText.text(locale, "saveNewDraft")}</Button><Button variant="outline" disabled={!canPublish} onClick={() => void action("publish")}>{adminText.text(locale, "publishSelectedDraft")}</Button>{dirty && <Button variant="ghost" onClick={() => { setPayload(state?.active?.payload ?? null); setSelected(state?.active?.id); setDirty(false); }}>{adminText.text(locale, "discardChanges")}</Button>}</div>
    </fieldset>}
    {!!state?.versions.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left font-medium">{adminText.text(locale, "resourceVersionHistory")}</caption><thead><tr><th className="p-2">{adminText.text(locale, "version")}</th><th className="p-2">{adminText.text(locale, "status")}</th><th className="p-2">{adminText.text(locale, "actions")}</th></tr></thead><tbody>{state.versions.map(version => <tr key={version.id} className="border-t"><td className="p-2">{version.id}{selected === version.id ? " ✓" : ""}</td><td className="p-2">{version.status === "active" ? adminText.text(locale, "active2") : version.status === "draft" ? adminText.text(locale, "draft") : adminText.text(locale, "retired")}</td><td className="flex flex-wrap gap-2 p-2"><Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void open(version.id)}>{adminText.text(locale, "open")}</Button>{version.status === "retired" && <Button size="sm" variant="outline" disabled={busy || dirty || !reason.trim()} onClick={() => void action("rollback", version.id)}>{adminText.text(locale, "restoreAndPublish")}</Button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
