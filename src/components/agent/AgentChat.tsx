"use client";
import { INTERNAL_ANSWER_MARKERS } from "@/agent-answer";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, convertFileListToFileUIParts, type FileUIPart, type UIMessage } from "ai";
import { ArrowUpRight, BookOpen, Bot, ClipboardCheck, FileText, Paperclip, Plus, RotateCcw, Settings2, Upload, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { PlanArtifactView } from "@/components/agent/PlanArtifactView";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxTrigger, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AgentComposerMenu } from "./AgentComposerMenu";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { accountOrbColor } from "@/account-orb";
import { AgentConversationScrollArea } from "./AgentConversationScrollArea";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatBubble, ChatPanel, LoadingState, PromptBar, StreamingText, ThinkingState, ToolChip } from "./beautiful/ChatPrimitives";
import dialogueStyles from "./beautiful/Dialogue.module.css";
import billingStyles from "@/components/billing/BillingPrototype.module.css";
import personaStyles from "./PersonaPreview.module.css";
import { AgentCreditBalance } from "./AgentCreditBalance";
import { subscribeBillingUpdates } from "@/lib/billing-events";
import { PersonaAvatar, readPersonaAvatar } from "./PersonaAvatar";
import { parsePersonaAvatar } from "@/agent-persona-avatar";
import { AGENT_PERSONA_SELECTION_KEY, builtinAgentPersona, resolveAgentPersonaSelection, type AgentPersona, type BuiltinAgentPersona, type UploadedAgentPersona } from "@/agent-personas";
import { buildAgentDisplayTurns, hasActiveAgentContent } from "@/agent-response-layout";
import { agentChatErrorMessage } from "@/agent-chat-errors";
import { useAgentRuntime } from "./AgentRuntimeProvider";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useAgentViewport } from "@/hooks/use-agent-viewport";
import { useIsMobile } from "@/hooks/use-mobile";
import { AGENT_BROADCAST_CHANNEL, agentArtifactFromOutput, requestAgentArtifactOpen } from "@/agent-artifact-bridge";
import type { AgentPlanProjection } from "@/server/agent/plan-artifact";

type AgentStatus = "loading" | "ready" | "unconfigured" | "unauthenticated" | "payment_required" | "unavailable";
type AgentModelChoice = { id: "deepseek" | "glm"; label: string };

type PersonaCard = UploadedAgentPersona;

const MAX_PERSONA_LENGTH = 36_000;
const BUILTIN_PERSONA_THEMES = { blue: billingStyles.monthly, red: personaStyles.closure, yellow: personaStyles.sunny } satisfies Record<BuiltinAgentPersona["theme"], string>;
const LOCAL_PERSONA_STORAGE_KEY = "riic.agent.persona.v1";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const ACCEPTED_ATTACHMENT_TYPES = ["image/", "text/", "application/pdf", "application/json", "application/vnd.openxmlformats-officedocument", "application/vnd.ms-excel"];
const ACCEPTED_ATTACHMENT_EXTENSIONS = [".md", ".markdown", ".txt", ".json", ".pdf", ".csv", ".xlsx"];

function readLocalPersona(): PersonaCard | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_PERSONA_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.content !== "string" || !value.content.trim() || value.content.length > MAX_PERSONA_LENGTH) return null;
    return {
      id: typeof value.id === "string" ? value.id : `local-${Date.now()}`,
      name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, 40) : "自定义人格",
      description: typeof value.description === "string" ? value.description.slice(0, 120) : "保存在此浏览器中的人格卡。",
      content: value.content.slice(0, MAX_PERSONA_LENGTH),
      kind: "upload",
      filename: typeof value.filename === "string" ? value.filename.slice(0, 120) : undefined,
      avatarUrl: parsePersonaAvatar(value.avatarUrl),
    };
  } catch {
    return null;
  }
}

function saveLocalPersona(persona: PersonaCard) {
  try {
    window.localStorage.setItem(LOCAL_PERSONA_STORAGE_KEY, JSON.stringify({
      version: 1,
      id: persona.id,
      name: persona.name,
      description: persona.description,
      content: persona.content,
      filename: persona.filename,
      avatarUrl: persona.avatarUrl,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

function clearLocalPersona() {
  try {
    window.localStorage.removeItem(LOCAL_PERSONA_STORAGE_KEY);
  } catch {
    return;
  }
}

const TOOL_LABELS: Record<string, string> = {
  resolve_operator: "干员身份核实",
  calculate_mastery: "专精方案计算",
  calculate_recruitment: "公招组合计算",
  analyze_stock_and_training: "库存与培养分析",
  analyze_daily_production: "日产出分析",
  diagnose_account_health: "账号体检诊断",
  preview_solve_defaults: "排班配置预览",
  diagnose_account: "账号数据诊断",
  solve_schedule: "排班求解",
  query_skills: "基建技能查询",
  kb_route: "知识库导诊",
  kb_read: "知识库阅读",
  load_agent_skill: "任务指引加载",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

interface AgentToolPartView {
  type: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  output?: unknown;
  errorText?: string;
}

function isToolPart(part: { type: string }): part is AgentToolPartView {
  return part.type.startsWith("tool-");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function formatEnvironmentSummary(environment: Record<string, unknown>, sources: Record<string, unknown>) {
  const labels: Record<string, string> = { sami: "萨米", abyssal: "深海猎人", knights: "骑士", defence: "防守方", attack: "进攻方", siracusa: "叙拉古", fireworks: "人间烟火" };
  const groups = new Map<string, string[]>();
  for (const [key, value] of Object.entries(environment)) {
    const raw = String(sources[key] ?? "默认值");
    const source = raw.startsWith("默认值") ? "默认" : raw === "手动指定" ? "用户指定" : raw;
    groups.set(source, [...(groups.get(source) ?? []), `${labels[key] ?? key} ${value}`]);
  }
  return [...groups].map(([source, values]) => `${source}：${values.join("、")}`).join("；");
}

function MasteryWarnings({ warnings }: { warnings: unknown }) {
  if (!Array.isArray(warnings)) return null;
  return <>{warnings.map((value, index) => {
    const warning = asRecord(value);
    return typeof warning?.message === "string" ? <p key={index} role="status" className="text-amber-600 dark:text-amber-300">{warning.message}</p> : null;
  })}</>;
}

export function ToolResultSummary({ name, output, openLabel = "在基建计算器打开" }: { name: string; output: unknown; openLabel?: string }) {
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const handoff = agentArtifactFromOutput(output);
  const record = asRecord(output);
  if (!record) return null;
  if (name === "solve_schedule" && record.plan) {
    const plan = asRecord(record.plan) as unknown as AgentPlanProjection;
    const summary = asRecord(plan.summary);
    return (
      <div className="grid gap-2 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>布局 {String(plan.layoutLabel ?? record.layoutPreset ?? "?")}</span>
          <span>干员 {String(record.operatorCount ?? "?")}</span>
          <span>精二池就绪 {String(summary?.tier_up_owned ?? "?")}</span>
          {Array.isArray(record.tradeOrders) && record.tradeOrders.length > 0 ? (
            <span>
              贸易订单 {record.tradeOrders.map((order) => (order === "originium" ? "开采协力" : "龙门商法")).join(" / ")}
            </span>
          ) : null}
        </div>
        {handoff ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              className="w-fit"
              onClick={() => {
                setHandoffError(null);
                try { requestAgentArtifactOpen(handoff); }
                catch (error) { setHandoffError(error instanceof Error ? error.message : "临时交接失败，请重试。"); }
              }}
            >
              {openLabel}<ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
            {handoffError ? <p role="alert" className="text-destructive">{handoffError}</p> : null}
          </div>
        ) : null}
        <details className="rounded border bg-muted/20 px-2 py-1">
          <summary className="cursor-pointer select-none text-xs font-medium">在对话中查看完整排班（可切换班次）</summary>
          <div className="mt-2"><PlanArtifactView plan={plan} dense /></div>
        </details>
      </div>
    );
  }
  if (name === "calculate_mastery" && record.simple && record.fast) {
    const settings = asRecord(record.settings);
    const sources = asRecord(record.settingsSources);
    const observation = asRecord(record.environmentObservation);
    return <div className="grid gap-2 text-xs">
      <p>{String(asRecord(record.targetOperator)?.name)} · 干员池：{String(record.sourceName)}</p>
      <p>起始专精 {String(settings?.current)} → {String(settings?.target)} · 中枢 {settings?.controlBonus ? "+5%" : "0%"}（{String(sources?.controlBonus ?? "默认值")}） · 换人余量 {String(settings?.bufferMinutes)} 分钟</p>
      <p>{formatEnvironmentSummary(asRecord(settings?.environment) ?? {}, asRecord(sources?.environment) ?? {})}</p>
      {observation ? <><p>森空岛快照：{typeof observation.storeTs === "number" && observation.storeTs > 0 ? new Date(observation.storeTs * 1000).toLocaleString("zh-CN") : "时间未知"}</p><p className="text-amber-600 dark:text-amber-300">{String(observation.warning)}</p></> : null}
      {record.isSample === true ? <p className="text-muted-foreground">按全精二示例干员池计算，不代表个人实际持有与练度。</p> : null}
      <MasteryWarnings warnings={record.warnings} />
      {(["simple", "fast"] as const).map((mode) => {
        const plan = asRecord(record[mode]);
        return <details key={mode} className="rounded border p-2" open={mode === "simple"}>
          <summary className="cursor-pointer">{mode === "simple" ? "简单方案" : "快速方案"} · {String(plan?.totalTime)} · 换人 {String(plan?.switches)} 次</summary>
          {Array.isArray(plan?.instructions) ? plan.instructions.map((stage, index) => <ol key={index} className="mt-2 grid gap-1 border-t pt-2">
            {Array.isArray(stage) ? stage.map((step, stepIndex) => {
              const item = asRecord(step);
              const seconds = Math.ceil(Number(item?.elapsed ?? 0));
              const time = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
              return <li key={stepIndex}>+{time} · {String(item?.text ?? "")}</li>;
            }) : null}
          </ol>) : null}
        </details>;
      })}
      <p className="text-muted-foreground">{String(record.assumptions)}</p>
    </div>;
  }
  if (name === "calculate_recruitment" && Array.isArray(record.results)) {
    return <div className="grid gap-2 text-xs">
      <p>招聘 {String(record.minutes)} 分钟 · 干员池：{String(record.sourceName)}</p>
      {record.ownershipKnown === false ? <p className="text-muted-foreground">示例干员池：个人拥有状态未知。</p> : null}
      {record.results.length === 0 ? <p>没有符合当前词条和筛选条件的组合。</p> : null}
      {record.results.map((value, index) => {
        const result = asRecord(value);
        return <details key={index} className="rounded border p-2">
          <summary className="cursor-pointer">{Array.isArray(result?.tags) ? result.tags.join(" + ") : ""} · 最低 {String(result?.minimumRarity)}★</summary>
          <p className="mt-1 leading-5">{Array.isArray(result?.operators) ? result.operators.map((value) => {
            const operator = asRecord(value);
            return `${operator?.name} ${operator?.rarity}★${operator?.ownership === "missing" ? "（未拥有）" : ""}`;
          }).join("、") : ""}</p>
        </details>;
      })}
      <p className="text-muted-foreground">{String(record.assumptions)}</p>
    </div>;
  }
  if (name === "diagnose_account") {
    const skland = asRecord(record.skland);
    if (!skland) return null;
    const pool = asRecord(record.operatorPool);
    if (skland.connected !== true) {
      return <div className="grid gap-1 text-xs text-muted-foreground"><p>森空岛未连接：{String(skland.reason ?? "")}</p><p>干员池：{String(pool?.sourceName ?? "未知")} · 干员 {String(pool?.owned ?? "?")} / 精二 {String(pool?.elite2 ?? "?")}</p></div>;
    }
    const player = asRecord(skland.player);
    const operbox = asRecord(skland.operbox);
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{String(player?.nickname ?? "?")}（{player?.level != null ? `Lv.${String(player.level)}` : "等级未知"}）</span>
        <span>干员 {String(operbox?.owned ?? "?")} / 精二 {String(operbox?.elite2 ?? "?")}</span>
        {Array.isArray(operbox?.elite2SixStarNames) ? <span>精二六星 {operbox.elite2SixStarNames.length} 名</span> : null}
      </div>
    );
  }
  if (name === "resolve_operator" && record.operator) return <div className="grid gap-2 text-xs"><p className="text-muted-foreground">{String(asRecord(record.operator)?.name)}</p><MasteryWarnings warnings={record.warnings} /></div>;
  if (["kb_read", "kb_route", "query_skills", "load_agent_skill"].includes(name)) return null;
  return null;
}

export function AgentToolCard({ part, animate = false, active = true }: { part: AgentToolPartView; animate?: boolean; active?: boolean }) {
  const name = part.type.slice("tool-".length);
  const record = asRecord(part.output);
  const pending = part.state === "input-streaming" || part.state === "input-available";
  const running = active && pending;
  const interrupted = !active && pending;
  const failed = interrupted || part.state === "output-error" || !!record?.error;
  const knowledge = ["query_skills", "kb_route", "kb_read", "load_agent_skill"].includes(name);
  const object = name === "query_skills" ? record?.query : name === "kb_route" ? "" : record?.title;
  const safeObject = typeof object === "string" && !/[\\/\n\r]/.test(object) ? object.slice(0, 100) : "";
  const label = toolLabel(name);
  const suffix = knowledge && safeObject ? name === "kb_read" || name === "load_agent_skill" ? `《${safeObject}》` : ` · ${safeObject}` : "";
  return <ToolChip name={name} running={running} failed={failed} animate={animate} label={running ? `正在调用 ${label}…` : interrupted ? `${label} 已停止` : failed ? `${label} 出错` : `${label} 完成${suffix}`}>
    {failed ? <p role="alert" className="text-xs text-destructive">{interrupted ? "本次调用已停止，可以重新提问。" : knowledge ? "本次查询暂未完成，请稍后重试。" : String(part.errorText ?? record?.error ?? "工具调用失败")}</p>
      : part.state === "output-available" && !knowledge ? <ToolResultSummary name={name} output={part.output} /> : undefined}
  </ToolChip>;
}

function AttachmentPreview({ file, onRemove }: { file: FileUIPart; onRemove?: () => void }) {
  const image = file.mediaType.startsWith("image/");
  return <div className="group relative flex min-w-0 items-center gap-2 rounded-xl border border-border/80 bg-background/80 px-2.5 py-2 text-xs shadow-sm">
    {image ? <img src={file.url} alt={file.filename ?? "图片附件"} className="size-10 shrink-0 rounded-lg object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-5" aria-hidden="true" /></span>}
    <span className="min-w-0"><span className="block max-w-44 truncate font-medium">{file.filename ?? "未命名文件"}</span><span className="block text-[11px] text-muted-foreground">{image ? "图片" : file.mediaType || "文件"}</span></span>
    {onRemove ? <Button type="button" variant="ghost" size="icon-xs" aria-label={`移除 ${file.filename ?? "附件"}`} className="absolute -top-1 -right-1 size-7 rounded-full border bg-background text-muted-foreground shadow-sm" onClick={onRemove}><X className="size-3" aria-hidden="true" /></Button> : null}
  </div>;
}

export function AgentChat({ conversationId, initialMessages, userName, userId, billingAllowed = false }: { conversationId: string; initialMessages: UIMessage[]; userName?: string; userId?: string; billingAllowed?: boolean }) {
  useAgentViewport();
  const isMobile = useIsMobile();
  const en = useLocale() === "en";
  const intl = useTranslations();
  const { store: historyStore, error: historyError } = useAgentHistory();
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("loading");
  const [creditRevision, setCreditRevision] = useState(0);
  useEffect(() => subscribeBillingUpdates(() => {
    if (agentStatus === "payment_required") setCreditRevision(value => value + 1);
  }), [agentStatus]);
  const [modelChoices, setModelChoices] = useState<AgentModelChoice[]>([]);
  const [automaticRouting, setAutomaticRouting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AgentModelChoice["id"]>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [activePersona, setActivePersona] = useState<AgentPersona | null>(null);
  const [uploadedPersona, setUploadedPersona] = useState<PersonaCard | null>(null);
  const [builtinPersonas, setBuiltinPersonas] = useState<BuiltinAgentPersona[]>([]);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [personaHydrated, setPersonaHydrated] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const modeAnchor = useRef<HTMLButtonElement>(null);
  const touchY = useRef<number | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const personaInputRef = useRef<HTMLInputElement>(null);
  const personaAvatarInputRef = useRef<HTMLInputElement>(null);
  const [restoredMessageIds] = useState(() => new Set(initialMessages.map((message) => message.id)));
  const runtime = useAgentRuntime();
  const [runtimeConversation] = useState(() => runtime.getConversation(userId ?? "anonymous", conversationId, initialMessages, historyStore.save,
    () => new Chat({ id: conversationId, messages: initialMessages, transport: new DefaultChatTransport({ api: "/api/agent/chat" }) })));
  const { messages, sendMessage, status, error, stop, clearError, regenerate } = useChat({
    chat: runtimeConversation.chat,
    throttle: 50,
  });
  const busy = status === "submitted" || status === "streaming";
  const personaName = activePersona?.name ?? (en ? "Closure" : "可露希尔");
  const personaAvatar = activePersona?.kind === "upload" ? activePersona.avatarUrl : undefined;
  const personaMascot = activePersona?.kind === "builtin" ? activePersona.avatar : undefined;
  const personaTheme = activePersona?.kind === "builtin" ? BUILTIN_PERSONA_THEMES[activePersona.theme] : !activePersona ? personaStyles.closure : "";
  const personaUnavailable = activePersona?.kind === "builtin" && !builtinPersonas.some(persona => persona.id === activePersona.id);
  const displayTurns = useMemo(() => buildAgentDisplayTurns(messages, busy), [messages, busy]);
  const modeLabel = (id?: AgentModelChoice["id"]) => id === "glm" ? (en ? "Deep" : "深度模式") : (en ? "Fast" : "快速模式");
  const currentModel = modelChoices.find((choice) => choice.id === selectedModel);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const resize = () => {
      if (!mobile.matches) setHeaderHidden(false);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); };
  }, []);

  // Only deliberate reading gestures collapse the header; streaming and history
  // restoration also scroll the viewport and must not move the controls.
  const readingGesture = (delta: number) => {
    const viewport = conversationRef.current;
    if (!window.matchMedia("(max-width: 767px)").matches || !viewport) return;
    if (delta < -12) setHeaderHidden(false);
    else if (delta > 12 && viewport.scrollHeight > viewport.clientHeight + 24) setHeaderHidden(true);
  };

  useEffect(() => {
    const stored = readLocalPersona();
    setUploadedPersona(stored);
    try { setActivePersona(resolveAgentPersonaSelection(window.localStorage.getItem(AGENT_PERSONA_SELECTION_KEY), stored)); }
    catch { setActivePersona(stored); }
    setPersonaHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/chat", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          if (!cancelled) setAgentStatus("unauthenticated");
          return;
        }
        if (response.status === 402) {
          if (!cancelled) setAgentStatus("payment_required");
          return;
        }
        if (!response.ok) {
          if (!cancelled) setAgentStatus("unavailable");
          return;
        }
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { enabled?: boolean; automatic?: boolean; personas?: { id?: unknown }[]; provider?: AgentModelChoice["id"]; models?: AgentModelChoice[] };
        };
        if (!cancelled) {
          const choices = payload.data?.models ?? [];
          setModelChoices(choices);
          setAutomaticRouting(payload.data?.automatic === true);
          const previous = (runtimeConversation.requestOptions?.body as { model?: unknown } | undefined)?.model;
          setSelectedModel(choices.find((choice) => choice.id === previous)?.id
            ?? choices.find((choice) => choice.id === "deepseek")?.id
            ?? choices[0]?.id ?? payload.data?.provider);
          setBuiltinPersonas((payload.data?.personas ?? []).flatMap(card => {
            const persona = builtinAgentPersona(card.id);
            return persona ? [persona] : [];
          }));
          if (payload.data?.enabled) {
            setAgentStatus("ready");
          } else {
            setAgentStatus("unconfigured");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setAgentStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeConversation, creditRevision]);

  useLayoutEffect(() => {
    const container = conversationRef.current;
    if (!container) return;
    const follow = () => { if (followMessages.current) container.scrollTop = container.scrollHeight; };
    follow();
    // Restored history can settle before the composer, fonts and scrollbar do.
    // Follow layout changes while the reader is still at the latest message.
    const observer = new ResizeObserver(follow);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    container.addEventListener("yeye-scrollbar-ready", follow);
    return () => {
      observer.disconnect();
      container.removeEventListener("yeye-scrollbar-ready", follow);
    };
  }, [messages, agentStatus, status]);

  // 求解完成时通知同浏览器内已打开的工作台标签页（幂等，每个工具结果只广播一次）。
  // Restoring history must not re-announce old solver results to other pages.
  const broadcastRef = useRef<Set<string>>(new Set(initialMessages.flatMap((message) => message.parts.map((_, index) => `${message.id}:${index}`))));
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    channelRef.current ??= new BroadcastChannel(AGENT_BROADCAST_CHANNEL);
    for (const message of messages) {
      message.parts.forEach((part, partIndex) => {
        if (!isToolPart(part) || part.type !== "tool-solve_schedule" || part.state !== "output-available") return;
        const handoff = agentArtifactFromOutput(part.output);
        if (!handoff) return;
        const key = `${message.id}:${partIndex}`;
        if (broadcastRef.current.has(key)) return;
        broadcastRef.current.add(key);
        channelRef.current?.postMessage({
          type: "plan-ready",
          ...handoff,
        });
      });
    }
  }, [messages]);

  useEffect(() => () => {
    channelRef.current?.close();
    channelRef.current = null;
  }, []);

  const submit = async (text: string, files = attachments) => {
    const trimmed = text.trim();
    if (!personaHydrated || personaUnavailable || (!trimmed && files.length === 0) || busy || runtimeConversation.running || agentStatus !== "ready") return;
    setDraft("");
    setAttachments([]);
    followMessages.current = true;
    runtime.setRequestOptions(runtimeConversation, { body: {
      model: selectedModel,
      conversationId, attemptId: crypto.randomUUID(),
      ...(activePersona ? { persona: activePersona.kind === "builtin" ? { id: activePersona.id, kind: "builtin" } : { id: activePersona.id, name: activePersona.name, content: activePersona.content } } : {}),
    } });
    await runtime.run(runtimeConversation, () => sendMessage(
      { text: trimmed, files },
      runtimeConversation.requestOptions,
    ));
  };

  const retryAnswer = async () => {
    if (busy || runtimeConversation.running) return;
    const question = [...messages].reverse().find((message) => message.role === "user");
    if (!question) return;
    clearError();
    followMessages.current = true;
    runtime.setRequestOptions(runtimeConversation, { body: { ...runtimeConversation.requestOptions?.body, model: selectedModel, conversationId, attemptId: crypto.randomUUID() } });
    await runtime.run(runtimeConversation, () => regenerate({ messageId: question.id, ...runtimeConversation.requestOptions }));
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploadError(null);
    const incoming = Array.from(fileList);
    if (incoming.length + attachments.length > MAX_ATTACHMENTS) {
      setUploadError(`最多同时发送 ${MAX_ATTACHMENTS} 个附件。`);
      return;
    }
    const invalid = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES || !(ACCEPTED_ATTACHMENT_TYPES.some((type) => file.type.startsWith(type)) || ACCEPTED_ATTACHMENT_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))));
    if (invalid) {
      setUploadError(`${invalid.name} 不受支持，或超过 8 MB 大小限制。`);
      return;
    }
    try {
      const next = await convertFileListToFileUIParts(fileList);
      setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS));
    } catch {
      setUploadError("读取附件失败，请重试或换一个文件。");
    }
  };

  const selectPersona = (persona: AgentPersona | null) => {
    setPersonaError(null);
    setActivePersona(persona);
    try { window.localStorage.setItem(AGENT_PERSONA_SELECTION_KEY, persona?.id ?? "default"); }
    catch { setPersonaError("人格卡已应用，但浏览器拒绝了保存选择。"); }
  };

  const importPersona = async (file: File) => {
    setPersonaError(null);
    if (file.size > MAX_PERSONA_LENGTH) {
      setPersonaError("人格卡需要小于 36 KB。");
      return;
    }
    try {
      const raw = await file.text();
      let content = raw.trim();
      let name = file.name.replace(/\.(md|markdown|txt|json)$/i, "") || "自定义人格";
      let description = "本次浏览器会话使用的自定义人格卡。";
      let avatarUrl: string | undefined;
      if (file.name.toLowerCase().endsWith(".json")) {
        try {
          const value = JSON.parse(raw) as Record<string, unknown>;
          name = typeof value.name === "string" ? value.name : name;
          description = typeof value.description === "string" ? value.description : description;
          avatarUrl = parsePersonaAvatar(value.avatarUrl ?? value.avatar);
          content = [value.system, value.persona, value.content, value.prompt, value.scenario].find((item) => typeof item === "string") as string ?? raw;
        } catch {
          content = raw;
        }
      }
      if (!content.trim()) throw new Error("人格卡内容为空");
      const persona: PersonaCard = { id: `upload-${Date.now()}`, name: name.slice(0, 40), description, content: content.slice(0, MAX_PERSONA_LENGTH), kind: "upload", filename: file.name, avatarUrl };
      setUploadedPersona(persona);
      selectPersona(persona);
      if (!saveLocalPersona(persona)) setPersonaError("人格卡已应用，但浏览器拒绝了本地保存。");
      setPersonaOpen(false);
    } catch (error) {
      setPersonaError(error instanceof Error ? error.message : "读取人格卡失败，请重试。");
    }
  };

  const updatePersonaAvatar = (avatarUrl?: string) => {
    if (!uploadedPersona) return;
    setPersonaError(null);
    const next = { ...uploadedPersona, avatarUrl };
    if (!saveLocalPersona(next)) { setPersonaError("头像未能保存，请检查浏览器存储空间后重试。"); return; }
    setUploadedPersona(next);
    if (activePersona?.id === next.id) setActivePersona(next);
  };

  const importPersonaAvatar = async (file: File) => {
    if (!uploadedPersona) return;
    setAvatarSaving(true);
    setPersonaError(null);
    try { updatePersonaAvatar(await readPersonaAvatar(file)); }
    catch (error) { setPersonaError(error instanceof Error ? error.message : "读取头像失败，请换一张图片重试。"); }
    finally { setAvatarSaving(false); }
  };

  const prompts = [
    { icon: ClipboardCheck, title: en ? "Account health" : "账号体检", text: "帮我看看账号现在什么水平" },
    { icon: Bot, title: en ? "Plan my base" : "规划基建", text: "我想搓玉，但不知道自己干员池适不适合" },
    { icon: BookOpen, title: en ? "Skill mastery" : "专精训练", text: "帮我算能天使从未专精到专三的训练方案" },
    { icon: UsersRound, title: en ? "Recruitment" : "公开招募", text: "公招有高级资深干员、狙击干员、远程位，九小时怎么选？" },
  ];
  return (
    <section className={`${dialogueStyles.theme} ${dialogueStyles.chat} ${personaTheme}`} data-agent-chat data-agent-persona={activePersona?.id ?? "default"}>
      <div className={dialogueStyles.headerSlot} data-agent-header-slot data-hidden={headerHidden} inert={headerHidden}>
      <header className={dialogueStyles.header} data-agent-header>
        <SidebarTrigger className="size-11 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <WorkbenchPageHeading page="agent" accentColor="var(--dialogue-accent)" className="max-md:gap-1 max-md:text-sm max-md:[&>span:first-child]:hidden"><span className="md:hidden">{en ? "Closure" : "可露希尔"}</span><span className="hidden md:inline">{en ? "Closure Assistant" : "可露希尔助理"}</span></WorkbenchPageHeading>
          <p className="mt-2 hidden text-xs text-muted-foreground md:block">{en ? "Your account, base and training — in one conversation." : "从了解账号到安排基建，把想做的事交给可露希尔。"}</p>
        </div>
        <div className={dialogueStyles.headerActions}>
        {automaticRouting && <span className="text-xs text-muted-foreground">{en ? "Auto" : "自动调度"}</span>}
        {modelChoices.length > 0 ? <Combobox items={modelChoices} filteredItems={modelChoices}
          value={currentModel ?? null}
          itemToStringValue={(choice) => `${modeLabel(choice.id)} ${choice.label}`} isItemEqualToValue={(choice, value) => choice.id === value.id}
          disabled={busy} onValueChange={(choice) => { if (choice) setSelectedModel(choice.id); }}>
          <ComboboxTrigger ref={modeAnchor} aria-label={`${en ? "Assistant mode" : "助理模式"}：${modeLabel(selectedModel)}`} className={dialogueStyles.modeTrigger}>
            <span className="min-w-0 text-left"><span className="block truncate text-xs font-semibold">{modeLabel(selectedModel)}</span><span className="block truncate text-[10px] leading-4 text-muted-foreground">{currentModel?.label}</span></span>
          </ComboboxTrigger>
          <ComboboxContent anchor={modeAnchor} className="min-w-56"><ComboboxList>{(choice) => <ComboboxItem key={choice.id} value={choice} className="min-h-14"><span><span className="block font-medium">{modeLabel(choice.id)}</span><span className="block text-xs text-muted-foreground">{choice.label}</span></span></ComboboxItem>}</ComboboxList></ComboboxContent>
        </Combobox> : null}
        <AgentCreditBalance enabled={billingAllowed && (agentStatus === "ready" || agentStatus === "payment_required" || agentStatus === "unconfigured")} busy={busy} en={en} />
        <Button type="button" variant="outline" size="sm" aria-label={en ? "New conversation" : "新对话"} title={en ? "New conversation" : "新对话"} className={dialogueStyles.newConversation} disabled={busy || messages.length === 0} onClick={() => { runtime.flush(); historyStore.startNew(); }}>
          <Plus className="size-4" aria-hidden="true" /><span className="max-md:hidden">{en ? "New conversation" : "新对话"}</span>
        </Button>
        </div>
      </header>
      </div>

      {historyError ? <p role="alert" className="text-xs text-destructive">{en ? "Chat history could not be saved in this browser. Keep this page open and check available storage." : "浏览器暂时无法保存对话历史，请暂勿关闭页面，并检查可用存储空间。"}</p> : null}
      {agentStatus === "ready" && personaUnavailable ? <p role="alert" className="text-xs text-destructive">{en ? "This persona is unavailable. Choose another persona to continue." : "所选人格卡暂不可用，请在输入框下方选择其他人格卡。"}</p> : null}

      <ChatPanel
        composer={agentStatus === "ready" ? <>
          <PromptBar
            busy={busy}
            disabled={!personaHydrated || personaUnavailable || (!draft.trim() && attachments.length === 0)}
            sendLabel={en ? "Send message" : "发送"}
            stopLabel={en ? "Stop generating" : "停止"}
            onSend={() => void submit(draft)}
            onStop={() => stop()}
            onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}
            input={{
              "aria-label": en ? `Message ${personaName}` : `发给${personaName}的消息`,
              placeholder: isMobile ? (en ? "Ask your assistant…" : "聊聊基建、干员…") : (en ? "Ask about your base, operators or next upgrade…" : "聊聊你的基建、干员，或下一步养成计划…"),
              rows: 1,
              value: draft,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit(draft);
                }
              },
            }}
            attachments={attachments.length ? <div className="flex flex-wrap gap-2 p-1">{attachments.map((file, index) => <AttachmentPreview key={`${file.filename}-${index}`} file={file} onRemove={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</div> : undefined}
            toolbar={<>
              <AgentComposerMenu en={en} personaName={activePersona?.name ?? (en ? "Closure" : "可露希尔")} onAttach={() => fileInputRef.current?.click()} onPersona={() => setPersonaOpen(true)} attachmentCount={attachments.length}>
                {attachments.map((file, index) => <AttachmentPreview key={`${file.filename}-${index}`} file={file} onRemove={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}
              </AgentComposerMenu>
              <input ref={fileInputRef} type="file" aria-label={en ? "Attach files" : "上传附件"} multiple accept="image/*,.md,.markdown,.txt,.json,.pdf,.csv,.xlsx" className="hidden" onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} />
              <Button type="button" variant="ghost" size="icon" className="hidden md:inline-flex size-9 rounded-lg text-muted-foreground" aria-label={en ? "Add attachment" : "添加附件"} title={en ? "Add attachment" : "添加附件"} onClick={() => fileInputRef.current?.click()}><Paperclip className="size-4" aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} className="hidden md:inline-flex max-w-40 rounded-lg text-xs text-muted-foreground" onClick={() => setPersonaOpen(true)}><Settings2 className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{en ? "Persona" : "人格卡"}：{personaName}</span></Button>
            </>}
          />
          {uploadError ? <p role="alert" className="mt-2 px-1 text-xs text-destructive">{uploadError}</p> : <p className="mt-2 hidden flex-wrap justify-between gap-1 px-1 text-[10px] text-muted-foreground md:flex"><span>{en ? "Up to 4 attachments · 8 MB each" : "最多 4 个附件 · 单个 ≤ 8 MB"}</span><span>{en ? "Enter to send · Shift + Enter for a new line" : "Enter 发送 · Shift + Enter 换行"}</span></p>}
        </> : null}
      >
        <AgentConversationScrollArea className={`${dialogueStyles.conversation} min-h-0 flex-1 bg-transparent`} viewportClassName="flex min-w-0 flex-col gap-6 overscroll-contain py-3 md:gap-10 md:py-8" viewportProps={{ ref: conversationRef,
          onScroll: (event) => { const el = event.currentTarget; followMessages.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (el.scrollTop <= 0) setHeaderHidden(false); },
          onWheel: (event) => readingGesture(event.deltaY),
          onTouchStart: (event) => { touchY.current = event.touches[0]?.clientY ?? null; },
          onTouchMove: (event) => { const y = event.touches[0]?.clientY; if (y !== undefined && touchY.current !== null && Math.abs(touchY.current - y) > 12) { readingGesture(touchY.current - y); touchY.current = y; } },
          onTouchEnd: () => { touchY.current = null; },
          onKeyDown: (event) => { if (event.target === event.currentTarget) { if (event.key === "PageDown" || event.key === "ArrowDown") readingGesture(20); if (["PageUp", "ArrowUp", "Home"].includes(event.key)) readingGesture(-20); } },
          role: "region", "aria-label": en ? "Conversation" : "对话记录", "aria-busy": busy }}>
          {agentStatus === "loading" ? <div className={dialogueStyles.activity}><LoadingState label={en ? "Connecting to Closure…" : "正在连接可露希尔…"} /></div> : null}
          {agentStatus === "unconfigured" ? <div className="my-auto grid justify-items-start gap-3 text-sm"><Bot className="size-6 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">{en ? "Assistant is not available yet" : "助理暂未就绪"}</h2><p className="text-muted-foreground">{en ? "The model connection needs to be configured. Please try again later." : "大模型连接尚未配置，请稍后重试。"}</p></div> : null}
          {agentStatus === "unavailable" ? <div role="alert" className="my-auto grid justify-items-start gap-3 text-sm"><h2 className="font-medium">{en ? "Could not connect to the assistant" : "暂时无法连接助理"}</h2><p className="text-muted-foreground">{en ? "Please refresh the page and try again." : "请刷新页面后重试。"}</p></div> : null}
          {agentStatus === "unauthenticated" ? <div className="my-auto grid justify-items-start gap-3 text-sm"><Bot className="size-6 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">{en ? "Sign in to meet Closure" : "登录后，与可露希尔开始对话"}</h2><p className="text-muted-foreground">{en ? "Use your website account to access the assistant." : "使用网站账号登录，即可让助理帮你诊断账号、规划基建。"}</p><Button nativeButton={false} render={<Link href="/account" />} size="sm" className="h-9 rounded-full px-4">{en ? "Sign in" : "前往账号管理登录"}</Button></div> : null}
          {agentStatus === "payment_required" ? <div className="my-auto grid justify-items-start gap-3 text-sm"><h2 className="font-medium">{en ? "Add credits to get started" : "补充积分，开始对话"}</h2><p className="text-muted-foreground">{en ? "You need at least 1 credit to use the assistant." : "当前账号需至少有 1 积分才能使用助理。"}</p>{billingAllowed ? <Button nativeButton={false} render={<Link href="/billing" />} size="sm" className={billingStyles.pill}>{en ? "View payment plans" : "查看付费计划"}</Button> : null}</div> : null}

          {messages.length === 0 && agentStatus === "ready" ? <div className="my-auto grid gap-7 py-4 sm:py-8">
            <div className="grid gap-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Bot className="size-4" aria-hidden="true" />{activePersona?.kind === "builtin" ? activePersona.identity[en ? "en" : "zh"] : activePersona?.name ?? (en ? "CLOSURE / RHODES ISLAND" : "可露希尔 / 罗德岛")}</p><h2 className="text-2xl font-medium tracking-tight sm:text-3xl">{activePersona?.kind === "builtin" ? activePersona.welcome[en ? "en" : "zh"] : (en ? "Doctor, where shall we start?" : "博士，今天从哪里开始？")}</h2><p className="max-w-lg text-sm leading-6 text-muted-foreground">{en ? "Tell me what you want to improve. I can check your account, calculate a plan and send the result to your workbench." : "说说你想改善什么。我可以检查账号、计算方案，再把结果交给你的工作台。"}</p></div>
            <div className="grid gap-2 sm:grid-cols-2">{prompts.map(({ icon: Icon, title, text }) => <button key={title} type="button" onClick={() => { setDraft(text); conversationRef.current?.closest("[data-agent-panel]")?.querySelector("textarea")?.focus(); }} className="group flex min-h-20 items-start gap-3 rounded-xl border border-border/70 px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{text}</span></span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </button>)}</div>
          </div> : null}

          {displayTurns.map((turn) => {
            if (turn.kind === "user") {
              const message = turn.message;
              const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
              return <ChatBubble key={turn.key} speaker="user" name={userName?.trim() || (en ? "Doctor" : "博士")} avatar={userId ? <FluidOrb size={38} color={accountOrbColor(userId)} style={{ width: "100%", height: "100%" }} data-account-orb-color={accountOrbColor(userId)} /> : undefined}>
              {message.parts.some((part) => part.type === "file") ? <div className="mb-2 flex flex-wrap gap-2">{message.parts.filter((part) => part.type === "file").map((part, index) => <AttachmentPreview key={index} file={part} />)}</div> : null}
              {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
            </ChatBubble>;
            }
            const waiting = turn.pending && (status === "submitted" || !hasActiveAgentContent(turn.messages.at(-1)));
            return <div key={turn.key} className={dialogueStyles.assistantTurn} data-agent-assistant-turn data-response-key={turn.key} data-pending={turn.pending}>
              {turn.messages.flatMap((message) => {
                const active = turn.pending && status !== "submitted" && message.id === messages.at(-1)?.id;
                const animate = !restoredMessageIds.has(message.id);
                const activeAvatarIndex = active ? message.parts.reduce((last, part, index) =>
                  part.type === "text" && part.state === "streaming" && !!part.text.trim() ? index : last, -1) : -1;
                return message.parts.map((part, partIndex) => {
                const key = `${message.id}:${partIndex}`;
                if (part.type === "text") return part.text.trim() ? <ChatBubble key={key} speaker="assistant" name={personaName} label={en ? `${personaName} reply` : `${personaName}的回答`} avatar={<PersonaAvatar name={personaName} src={personaAvatar} mascot={personaMascot} active={partIndex === activeAvatarIndex} />}><StreamingText content={INTERNAL_ANSWER_MARKERS.test(part.text) ? (en ? "This saved reply contains invalid formatting. Please ask again." : "这条历史回复的格式有误，请重新提问。") : part.text} running={active && part.state === "streaming"} animate={animate} previousParts={message.parts.slice(0, partIndex).flatMap((previous) => previous.type === "text" && !INTERNAL_ANSWER_MARKERS.test(previous.text) ? [previous.text] : [])} /></ChatBubble> : null;
                if (part.type === "reasoning") return part.text.trim() || (active && part.state === "streaming") ? <div key={key} className={dialogueStyles.activity}><ThinkingState label={en ? "Thinking" : "思考过程"} activeLabel={en ? "Thinking…" : "正在思考…"} running={active && part.state === "streaming"} animate={animate}>{part.text}</ThinkingState></div> : null;
                if (isToolPart(part)) {
                  // Keep every completed schedule in its original conversation position,
                  // including restored history, with an action that can be used again.
                  const output = asRecord(part.output);
                  const handoff = part.type === "tool-solve_schedule" && part.state === "output-available" && !output?.error && output?.plan ? agentArtifactFromOutput(part.output) : null;
                  if (handoff) {
                    return <ChatBubble key={key} speaker="assistant" name={personaName} label={en ? "Generated schedule" : "已生成的排班"} avatar={<PersonaAvatar name={personaName} src={personaAvatar} mascot={personaMascot} active={partIndex === activeAvatarIndex} />}>
                      <p className="mb-3 text-sm leading-6">{intl("App.agentArtifactBannerText", { preset: handoff.preset ? `（${handoff.preset}）` : "" })}</p>
                      <ToolResultSummary name="solve_schedule" output={part.output} openLabel={intl("App.agentArtifactOpen")} />
                    </ChatBubble>;
                  }
                  return <div key={key} className={dialogueStyles.activity}><AgentToolCard part={part} active={active} animate={animate} /></div>;
                }
                return null;
                });
              })}
              {waiting ? <div key="waiting" className={dialogueStyles.activity}><LoadingState label={en ? "Working on your request…" : "正在处理你的请求…"} /></div> : null}
            </div>;
          })}
          {error ? <div role="alert" className="grid justify-items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm"><p className="break-words text-destructive">{agentChatErrorMessage(error.message, en)}</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => { void retryAnswer(); }}><RotateCcw className="size-3.5" aria-hidden="true" />{en ? "Try again" : "重试回答"}</Button></div> : null}
        </AgentConversationScrollArea>
      </ChatPanel>

      <Dialog open={personaOpen} onOpenChange={(open) => { if (!avatarSaving) setPersonaOpen(open); }}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-[min(1160px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>人格卡</DialogTitle></DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto overscroll-contain pb-5 sm:pb-7">
            <div className="grid gap-3">
              <div className={personaStyles.cards}>
              {[null, ...builtinPersonas, ...(uploadedPersona ? [uploadedPersona] : [])].map((persona) => {
                const selected = (persona?.id ?? null) === (activePersona?.id ?? null);
                return <section key={persona?.id ?? "default"} className={`${billingStyles.card} ${billingStyles.product} ${personaStyles.preview} ${!persona ? personaStyles.closure : persona.kind === "builtin" ? BUILTIN_PERSONA_THEMES[persona.theme] : ""}`} aria-label={selected ? "当前人格卡预览" : `${persona?.name ?? "可露希尔"}人格卡`} data-persona-card={persona?.id ?? "default"} data-selected={selected ? "true" : undefined} data-persona-theme={persona?.kind === "builtin" ? persona.theme : undefined} data-persona-avatar-settings={selected ? "" : undefined}>
                <button type="button" className={personaStyles.cardSelect} disabled={avatarSaving || busy} aria-pressed={selected} aria-label={persona ? `使用${persona.name}` : "可露希尔 · 使用网站服务端当前配置的人格卡"} onClick={() => { if (!selected) selectPersona(persona); }} />
                <span aria-hidden="true" className={dialogueStyles.decoration} />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">人格卡</p>
                  <span className={`${billingStyles.productBadge} shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium`}>{persona?.kind === "builtin" ? "预设人格" : persona ? "本地人格" : "默认人格"}</span>
                </div>
                <div className={personaStyles.identity}>
                  <div className={personaStyles.portrait} aria-hidden="true"><PersonaAvatar name={persona?.name ?? "可露希尔"} src={persona?.kind === "upload" ? persona.avatarUrl : undefined} mascot={persona?.kind === "builtin" ? persona.avatar : undefined} size={80} /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className={personaStyles.name}>{persona?.name ?? "可露希尔"}</h3>
                    <p className={personaStyles.description}>{persona?.description || "罗德岛的基建搭档"}</p>
                  </div>
                </div>
                {persona?.kind === "upload" ? <div>
                  <p className={billingStyles.caption}>头像保存在当前浏览器<br />PNG / JPEG / WebP，最大 2 MB</p>
                  <div className={personaStyles.actions}>
                    <Button type="button" className={`${billingStyles.pill} ${billingStyles.primary}`} disabled={avatarSaving} onClick={() => personaAvatarInputRef.current?.click()}><Upload className="size-3.5" aria-hidden="true" />{avatarSaving ? "正在保存…" : "上传头像"}</Button>
                    <Button type="button" variant="ghost" className={billingStyles.pill} disabled={avatarSaving || !persona.avatarUrl} onClick={() => updatePersonaAvatar()}>重置头像</Button>
                  </div>
                    <p className={`${billingStyles.caption} mt-3 break-words`}>{persona.filename} · 已保存在此浏览器，下次打开优先使用</p>
                    <Button type="button" variant="link" size="sm" disabled={avatarSaving || busy} className="mt-1 h-auto px-0 text-xs text-muted-foreground" onClick={() => { clearLocalPersona(); setUploadedPersona(null); if (selected) selectPersona(null); }}>清除本地人格卡</Button>
                </div> : <div>
                  <p className={billingStyles.caption}>{persona?.caption ?? "使用网站服务端当前配置的人格卡"}</p>
                </div>}
              </section>;
              })}
              {!uploadedPersona ? <section className={`${billingStyles.card} ${billingStyles.product} ${personaStyles.preview}`} aria-label="导入人格卡">
                <span aria-hidden="true" className={dialogueStyles.decoration} />
                <div>
                  <Upload className="mb-5 size-6 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-lg font-semibold">添加你的人格卡</h3>
                  <p className={personaStyles.description}>导入喜欢的表达风格，打造自己的基建搭档。</p>
                </div>
                <div>
                  <p className={billingStyles.caption}>Markdown / TXT / JSON，最大 36 KB<br />保存在当前浏览器</p>
                  <Button type="button" variant="outline" className={`${billingStyles.pill} mt-3 w-full`} disabled={avatarSaving} onClick={() => personaInputRef.current?.click()}><Upload className="size-4" aria-hidden="true" />上传人格卡</Button>
                </div>
              </section> : null}
              </div>
              {uploadedPersona ? <input ref={personaAvatarInputRef} aria-label="上传人格卡头像" type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={avatarSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPersonaAvatar(file); event.currentTarget.value = ""; }} /> : null}
              <input ref={personaInputRef} aria-label="上传人格卡文件" type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" className="hidden" disabled={avatarSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPersona(file); event.currentTarget.value = ""; }} />
              {uploadedPersona ? <Button type="button" variant="outline" disabled={avatarSaving} className={`${billingStyles.pill} justify-self-start`} onClick={() => personaInputRef.current?.click()}><Upload className="size-4" aria-hidden="true" />上传人格卡</Button> : null}
              {personaError ? <p role="alert" className="text-xs text-destructive">{personaError}</p> : null}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </section>
  );
}
