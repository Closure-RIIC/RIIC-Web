"use client";

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
  const zh = useLocale() === "zh";
  const tr = (cn: string, en: string) => zh ? cn : en;
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
        setNotice(tr("已导入编辑区，保存草稿并发布后才会生效。", "Imported into the editor. Save a draft and publish it to apply."));
      } else {
        const next = await load();
        setSelected(result.id); setDirty(false);
        if (operation !== "draft") setPayload(next.active!.payload);
        setNotice(operation === "draft" ? tr("草稿已保存，尚未生效。", "Draft saved; not active yet.") : tr("已发布，下一轮请求使用此版本。", "Published. The next request uses this version."));
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
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6" aria-label={tr("Agent 资源管理", "Agent resources")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">{tr("人格、提示词与知识资源", "Personas, prompts and knowledge")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("发布后同一轮请求固定使用一份资源版本。模型切换保持相同人格和工具能力。", "Each request uses one resource version, shared across model switches.")}</p></div>
      <Button variant="outline" disabled={busy || dirty} onClick={() => void action("import")}>{tr("导入服务器资源", "Import server resources")}</Button>
    </div>
    <p className="text-sm">{tr("当前生效", "Active")}: <strong>{state?.active?.id ?? tr("服务器文件配置", "Configured server files")}</strong>{dirty && <span className="ml-3 text-muted-foreground">{tr("有未保存修改", "Unsaved changes")}</span>}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!payload && <p className="text-sm text-muted-foreground">{tr("导入现有资源以建立首个草稿；发布前仍使用当前服务器配置。", "Import existing resources to create the first draft. Server configuration remains active until publication.")}</p>}
    {payload && <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2" aria-label={tr("资源类别", "Resource categories")}>
        {[["prompt", "系统提示词", "System prompt"], ["persona", "人格卡", "Personas"], ["knowledge", "知识库", "Knowledge"], ["skills", "任务指引", "Skills"]].map(([id, cn, en]) => <Button key={id} variant={tab === id ? "default" : "outline"} aria-pressed={tab === id} onClick={() => setTab(id)}>{tr(cn, en)}</Button>)}
      </div>
      {tab === "prompt" && <Label className="block space-y-2">{tr("共享系统提示词", "Shared system prompt")}<Textarea aria-label={tr("共享系统提示词", "Shared system prompt")} className={textareaClass} value={payload.systemPrompt} onChange={event => edit({ ...payload, systemPrompt: event.target.value })} /><span className="block text-xs text-muted-foreground">{tr("中文回答、内部协议隔离及事实核实规范由服务端统一追加。", "The server adds shared language, protocol isolation and fact-checking rules.")}</span></Label>}
      {tab === "persona" && <div className="space-y-3">
        <Label>{tr("选择人格", "Choose persona")}<select className="h-9 max-w-full rounded-md border bg-background px-2" aria-label={tr("选择人格", "Choose persona")} value={persona} onChange={event => setPersona(event.target.value)}><option value="default">{tr("默认助理", "Default assistant")}</option>{payload.personas.map(card => <option key={card.id} value={card.id}>{BUILTIN_AGENT_PERSONAS.find(item => item.id === card.id)?.name ?? card.id}</option>)}</select></Label>
        {persona !== "default" && selectedPersona && <Label><input type="checkbox" checked={selectedPersona.enabled} onChange={event => edit({ ...payload, personas: payload.personas.map(item => item.id === persona ? { ...item, enabled: event.target.checked } : item) })} />{tr("启用此人格", "Enable this persona")}</Label>}
        <Label className="block space-y-2">{tr("人格正文", "Persona content")}<Textarea className={textareaClass} value={persona === "default" ? payload.defaultPersona : selectedPersona?.content ?? ""} onChange={event => edit(persona === "default" ? { ...payload, defaultPersona: event.target.value } : { ...payload, personas: payload.personas.map(item => item.id === persona ? { ...item, content: event.target.value } : item) })} /></Label>
      </div>}
      {tab === "knowledge" && <div className="space-y-3">
        <Label>{tr("知识版本说明", "Knowledge version label")}<Input value={payload.knowledge.version} onChange={event => edit({ ...payload, knowledge: { ...payload.knowledge, version: event.target.value } })} /></Label>
        <Label className="block space-y-2">{tr("共享知识规则", "Shared knowledge rules")}<Textarea className={textareaClass} value={payload.knowledge.policy} onChange={event => edit({ ...payload, knowledge: { ...payload.knowledge, policy: event.target.value } })} /></Label>
        <Label>{tr("知识文档与索引", "Documents and indexes")}<select className="h-9 w-full min-w-0 rounded-md border bg-background px-2" aria-label={tr("知识文档与索引", "Documents and indexes")} value={document} onChange={event => setDocument(event.target.value)}><option value="">{tr("选择文件", "Choose a file")} ({payload.knowledge.files.length})</option>{payload.knowledge.files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select></Label>
        {selectedDoc && <Label className="block space-y-2">{tr("文档正文", "Document content")}<Textarea className={textareaClass} value={selectedDoc.content} onChange={event => edit({ ...payload, knowledge: { ...payload.knowledge, files: payload.knowledge.files.map(file => file.path === document ? { ...file, content: event.target.value } : file) } })} /></Label>}
      </div>}
      {tab === "skills" && <div className="space-y-3">
        <Label>{tr("选择任务指引", "Choose a skill")}<select className="h-9 max-w-full rounded-md border bg-background px-2" aria-label={tr("选择任务指引", "Choose a skill")} value={skill} onChange={event => setSkill(event.target.value)}><option value="">{tr("选择指引", "Choose a skill")}</option>{payload.skills.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Label>
        {selectedSkill && <><Label><input type="checkbox" checked={selectedSkill.enabled} onChange={event => edit({ ...payload, skills: payload.skills.map(item => item.id === skill ? { ...item, enabled: event.target.checked } : item) })} />{tr("启用此指引", "Enable this skill")}</Label>
          <Label>{tr("适用任务", "Purpose")}<Input value={selectedSkill.purpose} onChange={event => edit({ ...payload, skills: payload.skills.map(item => item.id === skill ? { ...item, purpose: event.target.value } : item) })} /></Label>
          <Label className="block space-y-2">{tr("指引正文", "Skill content")}<Textarea className={textareaClass} value={selectedSkill.content} onChange={event => edit({ ...payload, skills: payload.skills.map(item => item.id === skill ? { ...item, content: event.target.value } : item) })} /></Label></>}
      </div>}
      <Label>{tr("变更原因", "Reason for change")}<Input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></Label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !reason.trim()} onClick={() => void action("draft")}>{tr("保存为新草稿", "Save new draft")}</Button><Button variant="outline" disabled={!canPublish} onClick={() => void action("publish")}>{tr("发布选中草稿", "Publish selected draft")}</Button>{dirty && <Button variant="ghost" onClick={() => { setPayload(state?.active?.payload ?? null); setSelected(state?.active?.id); setDirty(false); }}>{tr("放弃修改", "Discard changes")}</Button>}</div>
    </fieldset>}
    {!!state?.versions.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left font-medium">{tr("资源版本历史", "Resource version history")}</caption><thead><tr><th className="p-2">{tr("版本", "Version")}</th><th className="p-2">{tr("状态", "Status")}</th><th className="p-2">{tr("操作", "Actions")}</th></tr></thead><tbody>{state.versions.map(version => <tr key={version.id} className="border-t"><td className="p-2">{version.id}{selected === version.id ? " ✓" : ""}</td><td className="p-2">{version.status === "active" ? tr("已发布", "Active") : version.status === "draft" ? tr("草稿", "Draft") : tr("历史版本", "Retired")}</td><td className="flex flex-wrap gap-2 p-2"><Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void open(version.id)}>{tr("打开", "Open")}</Button>{version.status === "retired" && <Button size="sm" variant="outline" disabled={busy || dirty || !reason.trim()} onClick={() => void action("rollback", version.id)}>{tr("恢复并发布", "Restore and publish")}</Button>}</td></tr>)}</tbody></table></div>}
  </section>;
}
