"use client";

import type { AppLocale } from "@riic/contracts/locale";
import { personaPresentation } from "@/agent-persona-presentation";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_agent_AgentChat.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_agent_AgentChat");


import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_agent_AgentChat.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_agent_AgentChat");

import { INTERNAL_ANSWER_MARKERS } from "@/agent-answer";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";

import { useEffect, useMemo, useRef, useState } from "react";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, convertFileListToFileUIParts, type FileUIPart, type UIMessage } from "ai";
import { ArrowDown, ArrowUpRight, Bot, ChevronDown, FileText, Paperclip, Plus, RotateCcw, Settings2, Upload, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";

import { PlanArtifactView } from "@/components/agent/PlanArtifactView";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxTrigger, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AgentComposerMenu } from "./AgentComposerMenu";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { accountOrbColor } from "@/account-orb";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
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
import { buildAgentDisplayTurns, hasActiveAgentContent, snapshotAgentReplyPersona } from "@/agent-response-layout";
import { agentChatErrorMessage } from "@/agent-chat-errors";
import { useAgentRuntime } from "./AgentRuntimeProvider";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useAgentViewport } from "@/hooks/use-agent-viewport";
import { useAgentScroll } from "@/hooks/use-agent-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import { AGENT_BROADCAST_CHANNEL, agentArtifactFromOutput, requestAgentArtifactOpen } from "@/agent-artifact-bridge";
import type { AgentPlanProjection } from "@/server/agent/plan-artifact";
import type { AgentPageContext } from "@/agent-page-context";

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
      name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, 40) : "",
      description: typeof value.description === "string" ? value.description.slice(0, 120) : "",
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

const TOOL_LABELS: Record<string, keyof typeof RawMessages> = {
  resolve_operator: "tool_resolve_operator",
  calculate_mastery: "tool_calculate_mastery",
  calculate_training: "tool_calculate_training",
  calculate_recruitment: "tool_calculate_recruitment",
  analyze_stock_and_training: "tool_analyze_stock_and_training",
  analyze_daily_production: "tool_analyze_daily_production",
  diagnose_account_health: "tool_diagnose_account_health",
  preview_solve_defaults: "tool_preview_solve_defaults",
  diagnose_account: "tool_diagnose_account",
  solve_schedule: "tool_solve_schedule",
  query_skills: "tool_query_skills",
  kb_route: "tool_kb_route",
  kb_read: "tool_kb_read",
  load_agent_skill: "tool_load_agent_skill",
};

function toolLabel(name: string, rawLocale: AppLocale): string {
  return TOOL_LABELS[name] ? rawText.text(rawLocale, TOOL_LABELS[name]) : name;
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

export function formatEnvironmentSummary(environment: Record<string, unknown>, sources: Record<string, unknown>, locale: AppLocale = "zh-CN") {
  const labels = { sami: "sami", abyssal: "abyssal", knights: "knights", defence: "defence", attack: "attack", siracusa: "siracusa", fireworks: "fireworks" } as const;
  const groups = new Map<string, string[]>();
  for (const [key, value] of Object.entries(environment)) {
    const raw = String(sources[key] ?? "");
    const source = !raw || raw.startsWith("默认值") ? uiText.text(locale, "defaultValue") : raw === "手动指定" ? uiText.text(locale, "manualValue") : raw;
    groups.set(source, [...(groups.get(source) ?? []), `${key in labels ? uiText.text(locale, labels[key as keyof typeof labels]) : key} ${value}`]);
  }
  return [...groups].map(([source, values]) => `${source}：${values.join(locale === "en" ? ", " : "、")}`).join("；");
}

function MasteryWarnings({ warnings }: { warnings: unknown }) {
  if (!Array.isArray(warnings)) return null;
  return <>{warnings.map((value, index) => {
    const warning = asRecord(value);
    return typeof warning?.message === "string" ? <p key={index} role="status" className="text-amber-600 dark:text-amber-300">{warning.message}</p> : null;
  })}</>;
}

export function ToolResultSummary({ name, output, openLabel }: { name: string; output: unknown; openLabel?: string }) {
  const rawLocale = useRawLocale();
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
          <span>{rawText.rich(rawLocale, "layout", { part1: richValue((String(plan.layoutLabel ?? record.layoutPreset ?? "?"))) })}</span>
          <span>{rawText.rich(rawLocale, "operators", { part1: richValue((String(record.operatorCount ?? "?"))) })}</span>
          <span>{rawText.rich(rawLocale, "elite2RosterReady", { part1: richValue((String(summary?.tier_up_owned ?? "?"))) })}</span>
          {Array.isArray(record.tradeOrders) && record.tradeOrders.length > 0 ? (
            <span>{rawText.rich(rawLocale, "tradingOrders", { part1: richValue((record.tradeOrders.map((order) => (order === "originium" ? rawText.text(rawLocale, "originiumOrder") : rawText.text(rawLocale, "goldOrder"))).join(" / "))) })}</span>
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
                catch (error) { setHandoffError(error instanceof Error ? error.message : rawText.text(rawLocale, "handoffFailed")); }
              }}
            >
              {openLabel ?? rawText.text(rawLocale, "openCalculator")}<ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
            {handoffError ? <p role="alert" className="text-destructive">{handoffError}</p> : null}
          </div>
        ) : null}
        <details className="rounded border bg-muted/20 px-2 py-1">
          <summary className="cursor-pointer select-none text-xs font-medium">{rawText.text(rawLocale, "viewTheFullScheduleInChatSwitchBetweenShifts")}</summary>
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
      <p>{rawText.rich(rawLocale, "roster", { part1: richValue((String(asRecord(record.targetOperator)?.name))), part2: richValue((String(record.sourceName))) })}</p>
      <p>{rawText.rich(rawLocale, "masteryControlCenterSwapAllowanceMin", { part1: richValue((String(settings?.current))), part2: richValue((String(settings?.target))), part3: richValue((settings?.controlBonus ? "+5%" : "0%")), part4: richValue((String(sources?.controlBonus ?? uiText.text(rawLocale, "defaultValue")))), part5: richValue((String(settings?.bufferMinutes))) })}</p>
      <p>{formatEnvironmentSummary(asRecord(settings?.environment) ?? {}, asRecord(sources?.environment) ?? {}, rawLocale)}</p>
      {observation ? <><p>{rawText.rich(rawLocale, "sklandSnapshot", { part1: richValue((typeof observation.storeTs === "number" && observation.storeTs > 0 ? new Date(observation.storeTs * 1000).toLocaleString(rawLocale) : rawText.text(rawLocale, "unknownTime"))) })}</p><p className="text-amber-600 dark:text-amber-300">{String(observation.warning)}</p></> : null}
      {record.isSample === true ? <p className="text-muted-foreground">{rawText.text(rawLocale, "calculatedUsingTheAllElite2SampleRosterThis")}</p> : null}
      <MasteryWarnings warnings={record.warnings} />
      {(["simple", "fast"] as const).map((mode) => {
        const plan = asRecord(record[mode]);
        return <details key={mode} className="rounded border p-2" open={mode === "simple"}>
          <summary className="cursor-pointer">{rawText.rich(rawLocale, "swaps", { part1: richValue((mode === "simple" ? rawText.text(rawLocale, "simplePlan") : rawText.text(rawLocale, "fastPlan"))), part2: richValue((String(plan?.totalTime))), part3: richValue((String(plan?.switches))) })}</summary>
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
  if (name === "calculate_training" && record.operator && record.lmd && record.experience) {
    const operator = asRecord(record.operator);
    const current = asRecord(record.current);
    const target = asRecord(record.target);
    const lmd = asRecord(record.lmd);
    const experience = asRecord(record.experience);
    const shortages = Array.isArray(record.materialShortages) ? record.materialShortages : [];
    const crafts = Array.isArray(record.crafts) ? record.crafts : [];
    return <div className="grid gap-2 text-xs">
      <p>{String(operator?.name)} · {String(record.source)}{record.owned === false ? rawText.text(rawLocale, "notCurrentlyOwned") : ""}</p>
      <p>{rawText.rich(rawLocale, "currentELvTargetELv", { part1: richValue((String(current?.elite))), part2: richValue((String(current?.level))), part3: richValue((String(target?.elite))), part4: richValue((String(target?.level))) })}</p>
      <p>{rawText.rich(rawLocale, "lmdAvailableMissing", { part1: richValue((Number(lmd?.required ?? 0).toLocaleString(rawLocale))), part2: richValue((Number(lmd?.stockWithGoldBars ?? 0).toLocaleString(rawLocale))), part3: richValue((Number(lmd?.missing ?? 0).toLocaleString(rawLocale))) })}</p>
      <p>{rawText.rich(rawLocale, "expAvailableMissingAboutStrategicBattleRecords", { part1: richValue((Number(experience?.required ?? 0).toLocaleString(rawLocale))), part2: richValue((Number(experience?.stock ?? 0).toLocaleString(rawLocale))), part3: richValue((Number(experience?.missing ?? 0).toLocaleString(rawLocale))), part4: richValue((String(experience?.missingBookEquivalent))) })}</p>
      {record.hasInventoryShortage === true ? <p>{rawText.rich(rawLocale, "missingMaterials", { part1: richValue((shortages.slice(0, 8).map((value) => {
        const item = asRecord(value);
        return `${String(item?.name)} ×${String(item?.missing)}`;
      }).join("、"))), part2: richValue((shortages.length > 8 ? rawText.text(rawLocale, "remainingMaterials", { count: shortages.length }) : "")) })}</p> : <p>{rawText.text(rawLocale, "yourInventoryCoversThisTarget")}</p>}
      {crafts.length ? <details className="rounded border p-2">
        <summary className="cursor-pointer">{rawText.rich(rawLocale, "craftingSuggestions", { part1: richValue((crafts.length)) })}</summary>
        <ul className="mt-2 grid gap-1">{crafts.map((value, index) => {
          const craft = asRecord(value);
          return <li key={index}>{rawText.rich(rawLocale, "craftingCost", { part1: richValue((String(craft?.name))), part2: richValue((String(craft?.count))), part3: richValue((Number(craft?.lmd ?? 0).toLocaleString(rawLocale))) })}</li>;
        })}</ul>
      </details> : null}
      {Array.isArray(record.warnings) ? record.warnings.map((warning, index) => <p key={index} className="text-amber-600 dark:text-amber-300">{String(warning)}</p>) : null}
    </div>;
  }
  if (name === "calculate_recruitment" && Array.isArray(record.results)) {
    return <div className="grid gap-2 text-xs">
      <p>{rawText.rich(rawLocale, "recruitmentMinRoster", { part1: richValue((String(record.minutes))), part2: richValue((String(record.sourceName))) })}</p>
      {record.ownershipKnown === false ? <p className="text-muted-foreground">{rawText.text(rawLocale, "sampleRosterYourOwnershipStatusIsUnknown")}</p> : null}
      {record.results.length === 0 ? <p>{rawText.text(rawLocale, "noCombinationsMatchTheCurrentTagsAndFilters")}</p> : null}
      {record.results.map((value, index) => {
        const result = asRecord(value);
        return <details key={index} className="rounded border p-2">
          <summary className="cursor-pointer">{rawText.rich(rawLocale, "minimum", { part1: richValue((Array.isArray(result?.tags) ? result.tags.join(" + ") : "")), part2: richValue((String(result?.minimumRarity))) })}</summary>
          <p className="mt-1 leading-5">{Array.isArray(result?.operators) ? result.operators.map((value) => {
            const operator = asRecord(value);
            return `${operator?.name} ${operator?.rarity}★${operator?.ownership === "missing" ? rawText.text(rawLocale, "notOwned") : ""}`;
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
      return <div className="grid gap-1 text-xs text-muted-foreground"><p>{rawText.rich(rawLocale, "sklandDisconnected", { part1: richValue((String(skland.reason ?? ""))) })}</p><p>{rawText.rich(rawLocale, "rosterOperatorsElite2", { part1: richValue((String(pool?.sourceName ?? rawText.text(rawLocale, "unknownSource")))), part2: richValue((String(pool?.owned ?? "?"))), part3: richValue((String(pool?.elite2 ?? "?"))) })}</p></div>;
    }
    const player = asRecord(skland.player);
    const operbox = asRecord(skland.operbox);
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{String(player?.nickname ?? "?")}（{player?.level != null ? `Lv.${String(player.level)}` : rawText.text(rawLocale, "unknownLevel")}）</span>
        <span>{rawText.rich(rawLocale, "operatorsElite2", { part1: richValue((String(operbox?.owned ?? "?"))), part2: richValue((String(operbox?.elite2 ?? "?"))) })}</span>
        {Array.isArray(operbox?.elite2SixStarNames) ? <span>{rawText.rich(rawLocale, "6Elite2Operators", { part1: richValue((operbox.elite2SixStarNames.length)) })}</span> : null}
      </div>
    );
  }
  if (name === "resolve_operator" && record.operator) return <div className="grid gap-2 text-xs"><p className="text-muted-foreground">{String(asRecord(record.operator)?.name)}</p><MasteryWarnings warnings={record.warnings} /></div>;
  if (["kb_read", "kb_route", "query_skills", "load_agent_skill"].includes(name)) return null;
  return null;
}

export function AgentToolCard({ part, animate = false, active = true }: { part: AgentToolPartView; animate?: boolean; active?: boolean }) {
  const rawLocale = useRawLocale();
  const name = part.type.slice("tool-".length);
  const record = asRecord(part.output);
  const pending = part.state === "input-streaming" || part.state === "input-available";
  const running = active && pending;
  const interrupted = !active && pending;
  const failed = interrupted || part.state === "output-error" || !!record?.error;
  const knowledge = ["query_skills", "kb_route", "kb_read", "load_agent_skill"].includes(name);
  const object = name === "query_skills" ? record?.query : name === "kb_route" ? "" : record?.title;
  const safeObject = typeof object === "string" && !/[\\/\n\r]/.test(object) ? object.slice(0, 100) : "";
  const label = toolLabel(name, rawLocale);
  const suffix = knowledge && safeObject ? name === "kb_read" || name === "load_agent_skill" ? `《${safeObject}》` : ` · ${safeObject}` : "";
  return <ToolChip name={name} running={running} failed={failed} animate={animate} label={running ? rawText.text(rawLocale, "toolRunning", { label }) : interrupted ? rawText.text(rawLocale, "toolStopped", { label }) : failed ? rawText.text(rawLocale, "toolError", { label }) : rawText.text(rawLocale, "toolComplete", { label, suffix })}>
    {failed ? <p role="alert" className="text-xs text-destructive">{interrupted ? rawText.text(rawLocale, "thisRequestWasStoppedYouCanAskAgain") : knowledge ? rawText.text(rawLocale, "thisQueryHasNotFinishedPleaseTryAgainLater") : String(part.errorText ?? record?.error ?? rawText.text(rawLocale, "toolFailed"))}</p>
      : part.state === "output-available" && !knowledge ? <ToolResultSummary name={name} output={part.output} /> : undefined}
  </ToolChip>;
}

function AttachmentPreview({ file, onRemove }: { file: FileUIPart; onRemove?: () => void }) {
  const rawLocale = useRawLocale();
  const image = file.mediaType.startsWith("image/");
  return <div className="group relative flex min-w-0 items-center gap-2 rounded-xl border border-border/80 bg-background/80 px-2.5 py-2 text-xs shadow-sm">
    {image ? <img src={file.url} alt={file.filename ?? rawText.text(rawLocale, "imageAttachment")} className="size-10 shrink-0 rounded-lg object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-5" aria-hidden="true" /></span>}
    <span className="min-w-0"><span className="block max-w-44 truncate font-medium">{file.filename ?? rawText.text(rawLocale, "unnamedFile")}</span><span className="block text-[11px] text-muted-foreground">{image ? rawText.text(rawLocale, "image") : file.mediaType || rawText.text(rawLocale, "file")}</span></span>
    {onRemove ? <Button type="button" variant="ghost" size="icon-xs" aria-label={rawText.text(rawLocale, "removeAttachment", { name: file.filename ?? rawText.text(rawLocale, "attachment") })} className="absolute -top-1 -right-1 size-7 rounded-full border bg-background text-muted-foreground shadow-sm" onClick={onRemove}><X className="size-3" aria-hidden="true" /></Button> : null}
  </div>;
}

export function AgentChat({ conversationId, initialMessages, userName, userId, billingAllowed = false, compact = false, pageContext, sharePageContext, onSharePageContextChange, onClose }: {
  conversationId: string;
  initialMessages: UIMessage[];
  userName?: string;
  userId?: string;
  billingAllowed?: boolean;
  compact?: boolean;
  pageContext?: AgentPageContext | null;
  sharePageContext?: boolean;
  onSharePageContextChange?: (value: boolean) => void;
  onClose?: () => void;
}) {
  const rawLocale = useRawLocale();
  useAgentViewport(!compact);
  const isMobile = useIsMobile();
  const en = useLocale();
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
  const { viewportRef: conversationRef, showLatest, followLatest, onScrollbarPointerDown } = useAgentScroll();
  const composing = useRef(false);
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
  const personaName = activePersona ? personaPresentation(activePersona, en).name : uiText.text(en, "closure");
  const personaTheme = activePersona?.kind === "builtin" ? BUILTIN_PERSONA_THEMES[activePersona.theme] : !activePersona ? personaStyles.closure : "";
  const personaUnavailable = activePersona?.kind === "builtin" && !builtinPersonas.some(persona => persona.id === activePersona.id);
  const displayTurns = useMemo(() => buildAgentDisplayTurns(messages, busy), [messages, busy]);
  const modeLabel = (id?: AgentModelChoice["id"]) => id === "glm" ? (uiText.text(en, "deep")) : (uiText.text(en, "fast"));
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
    if (compact || !window.matchMedia("(max-width: 767px)").matches || !viewport) return;
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
          data?: { enabled?: boolean; automatic?: boolean; personas?: { id?: unknown }[]; provider?: AgentModelChoice["id"] | null; models?: AgentModelChoice[] };
        };
        if (!cancelled) {
          const choices = payload.data?.models ?? [];
          const automatic = payload.data?.automatic === true;
          setModelChoices(choices);
          setAutomaticRouting(automatic);
          const previous = (runtimeConversation.requestOptions?.body as { model?: unknown } | undefined)?.model;
          setSelectedModel(automatic ? undefined : choices.find((choice) => choice.id === previous)?.id
            ?? choices.find((choice) => choice.id === "deepseek")?.id
            ?? choices[0]?.id ?? payload.data?.provider ?? undefined);
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
    followLatest();
    runtime.setRequestOptions(runtimeConversation, { body: {
      model: automaticRouting ? undefined : selectedModel,
      conversationId, attemptId: crypto.randomUUID(),
      ...(activePersona ? { persona: activePersona.kind === "builtin" ? { id: activePersona.id, kind: "builtin" } : { id: activePersona.id, name: activePersona.name, content: activePersona.content } } : {}),
      pageContext: compact && sharePageContext ? pageContext ?? null : null,
    } });
    await runtime.run(runtimeConversation, () => sendMessage(
      { text: trimmed, files, metadata: { replyPersona: snapshotAgentReplyPersona(activePersona) } },
      runtimeConversation.requestOptions,
    ));
  };

  const retryAnswer = async () => {
    if (busy || runtimeConversation.running) return;
    const question = [...messages].reverse().find((message) => message.role === "user");
    if (!question) return;
    clearError();
    followLatest();
    runtime.setRequestOptions(runtimeConversation, { body: {
      ...runtimeConversation.requestOptions?.body,
      model: automaticRouting ? undefined : selectedModel,
      conversationId,
      attemptId: crypto.randomUUID(),
      pageContext: compact && sharePageContext ? pageContext ?? null : null,
    } });
    await runtime.run(runtimeConversation, () => regenerate({ messageId: question.id, ...runtimeConversation.requestOptions }));
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploadError(null);
    const incoming = Array.from(fileList);
    if (incoming.length + attachments.length > MAX_ATTACHMENTS) {
      setUploadError(rawText.text(rawLocale, "attachmentLimit", { count: MAX_ATTACHMENTS }));
      return;
    }
    const invalid = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES || !(ACCEPTED_ATTACHMENT_TYPES.some((type) => file.type.startsWith(type)) || ACCEPTED_ATTACHMENT_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))));
    if (invalid) {
      setUploadError(rawText.text(rawLocale, "attachmentUnsupported", { name: invalid.name }));
      return;
    }
    try {
      const next = await convertFileListToFileUIParts(fileList);
      setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS));
    } catch {
      setUploadError(rawText.text(rawLocale, "attachmentReadFailed"));
    }
  };

  const selectPersona = (persona: AgentPersona | null) => {
    setPersonaError(null);
    setActivePersona(persona);
    try { window.localStorage.setItem(AGENT_PERSONA_SELECTION_KEY, persona?.id ?? "default"); }
    catch { setPersonaError(rawText.text(rawLocale, "personaSelectionNotSaved")); }
  };

  const importPersona = async (file: File) => {
    setPersonaError(null);
    if (file.size > MAX_PERSONA_LENGTH) {
      setPersonaError(rawText.text(rawLocale, "personaTooLarge"));
      return;
    }
    try {
      const raw = await file.text();
      let content = raw.trim();
      let name = file.name.replace(/\.(md|markdown|txt|json)$/i, "") || "";
      let description = "";
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
      if (!content.trim()) throw new Error(rawText.text(rawLocale, "emptyPersona"));
      const persona: PersonaCard = { id: `upload-${Date.now()}`, name: name.slice(0, 40), description, content: content.slice(0, MAX_PERSONA_LENGTH), kind: "upload", filename: file.name, avatarUrl };
      setUploadedPersona(persona);
      selectPersona(persona);
      if (!saveLocalPersona(persona)) setPersonaError(rawText.text(rawLocale, "personaNotSaved"));
      setPersonaOpen(false);
    } catch (error) {
      setPersonaError(error instanceof Error ? error.message : rawText.text(rawLocale, "personaReadFailed"));
    }
  };

  const updatePersonaAvatar = (avatarUrl?: string) => {
    if (!uploadedPersona) return;
    setPersonaError(null);
    const next = { ...uploadedPersona, avatarUrl };
    if (!saveLocalPersona(next)) { setPersonaError(rawText.text(rawLocale, "avatarNotSaved")); return; }
    setUploadedPersona(next);
    if (activePersona?.id === next.id) setActivePersona(next);
  };

  const importPersonaAvatar = async (file: File) => {
    if (!uploadedPersona) return;
    setAvatarSaving(true);
    setPersonaError(null);
    try { updatePersonaAvatar(await readPersonaAvatar(file, en)); }
    catch (error) { setPersonaError(error instanceof Error ? error.message : rawText.text(rawLocale, "avatarReadFailed")); }
    finally { setAvatarSaving(false); }
  };

  const pageGuideLines = pageContext?.summary.split("\n").filter(Boolean).slice(0, 3) ?? [];
  return (
    <section className={`${dialogueStyles.theme} ${dialogueStyles.chat} ${personaTheme} ${compact ? dialogueStyles.compactChat : ""}`} data-agent-chat data-agent-compact={compact ? "true" : undefined} data-agent-persona={activePersona?.id ?? "default"}>
      <div className={compact ? dialogueStyles.compactHeaderSlot : dialogueStyles.headerSlot} data-agent-header-slot data-hidden={headerHidden} inert={headerHidden}>
      {compact ? <header className={dialogueStyles.compactHeader} data-agent-header>
        <div className={`${dialogueStyles.avatar} ${dialogueStyles.compactAvatar}`} aria-hidden="true" data-agent-header-avatar><PersonaAvatar name={personaName} src={activePersona?.kind === "upload" ? activePersona.avatarUrl : undefined} mascot={activePersona?.kind === "builtin" ? activePersona.avatar : undefined} size={32} active={busy} /></div>
        <p className={dialogueStyles.compactTitle}>{personaName}</p>
        <div className={dialogueStyles.compactHeaderActions}>
        <Button type="button" variant="ghost" size="icon" className={dialogueStyles.compactHeaderAction} aria-label={uiText.text(en, "newConversation")} title={uiText.text(en, "newConversation")} disabled={busy || messages.length === 0} onClick={() => { runtime.flush(); historyStore.startNew(); }}><Plus className="size-4" aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className={dialogueStyles.compactHeaderAction} aria-label={uiText.text(en, "closeAssistant")} title={uiText.text(en, "closeAssistant")} onClick={onClose}><X className="size-4" aria-hidden="true" /></Button>
        </div>
      </header> : <header className={dialogueStyles.header} data-agent-header>
        <SidebarTrigger className="size-11 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <WorkbenchPageHeading page="agent" accentColor="var(--dialogue-accent)" className="max-md:gap-1 max-md:text-sm max-md:[&>span:first-child]:hidden"><span className="md:hidden">{uiText.text(en, "closure")}</span><span className="hidden md:inline">{uiText.text(en, "closureAssistant")}</span></WorkbenchPageHeading>
          <p className="mt-2 hidden text-xs text-muted-foreground md:block">{uiText.text(en, "yourAccountBaseAndTrainingInOneConversation")}</p>
        </div>
        <div className={dialogueStyles.headerActions}>
        {automaticRouting && <span className="text-xs text-muted-foreground">{uiText.text(en, "auto")}</span>}
        {modelChoices.length > 0 ? <Combobox items={modelChoices} filteredItems={modelChoices}
          value={currentModel ?? null}
          itemToStringValue={(choice) => `${modeLabel(choice.id)} ${choice.label}`} isItemEqualToValue={(choice, value) => choice.id === value.id}
          disabled={busy} onValueChange={(choice) => { if (choice) setSelectedModel(choice.id); }}>
          <ComboboxTrigger ref={modeAnchor} aria-label={`${uiText.text(en, "assistantMode")}：${modeLabel(selectedModel)}`} className={dialogueStyles.modeTrigger}>
            <span className="min-w-0 text-left"><span className="block truncate text-xs font-semibold">{modeLabel(selectedModel)}</span><span className="block truncate text-[10px] leading-4 text-muted-foreground">{currentModel?.label}</span></span>
          </ComboboxTrigger>
          <ComboboxContent anchor={modeAnchor} className="min-w-56"><ComboboxList>{(choice) => <ComboboxItem key={choice.id} value={choice} className="min-h-14"><span><span className="block font-medium">{modeLabel(choice.id)}</span><span className="block text-xs text-muted-foreground">{choice.label}</span></span></ComboboxItem>}</ComboboxList></ComboboxContent>
        </Combobox> : null}
        <AgentCreditBalance enabled={billingAllowed && (agentStatus === "ready" || agentStatus === "payment_required" || agentStatus === "unconfigured")} busy={busy} en={en} />
        <Button type="button" variant="outline" size="sm" aria-label={uiText.text(en, "newConversation")} title={uiText.text(en, "newConversation")} className={dialogueStyles.newConversation} disabled={busy || messages.length === 0} onClick={() => { runtime.flush(); historyStore.startNew(); }}>
          <Plus className="size-4" aria-hidden="true" /><span className="max-md:hidden">{uiText.text(en, "newConversation")}</span>
        </Button>
        </div>
      </header>}
      </div>
      {compact && onSharePageContextChange ? <div className={dialogueStyles.compactContextBar}>
        <span className={dialogueStyles.compactContextLabel}><FileText size={13} aria-hidden="true" />{uiText.text(en, "pageContext")}</span>
        <label className={dialogueStyles.compactShare}>
          <input type="checkbox" checked={Boolean(sharePageContext && pageContext)} disabled={!pageContext} aria-label={uiText.text(en, "includeCurrentPageContext")} onChange={(event) => onSharePageContextChange(event.currentTarget.checked)} />
          <span>{uiText.text(en, "shareWithAssistant")}</span>
        </label>
      </div> : null}

      {historyError ? <p role="alert" className="text-xs text-destructive">{uiText.text(en, "chatHistoryCouldNotBeSavedInThis")}</p> : null}
      {agentStatus === "ready" && personaUnavailable ? <p role="alert" className="text-xs text-destructive">{uiText.text(en, "thisPersonaIsUnavailableChooseAnotherPersonaTo")}</p> : null}

      <ChatPanel
        composer={agentStatus === "ready" ? <>
          {showLatest ? <Button type="button" size="sm" variant="outline" className="absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background shadow-sm" onClick={followLatest}>
            <ArrowDown className="size-3.5" aria-hidden="true" />{uiText.text(en, "backToLatest")}
          </Button> : null}
          <PromptBar
            busy={busy}
            disabled={!personaHydrated || personaUnavailable || (!draft.trim() && attachments.length === 0)}
            sendLabel={uiText.text(en, "sendMessage")}
            stopLabel={uiText.text(en, "stopGenerating")}
            onSend={() => void submit(draft)}
            onStop={() => stop()}
            onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}
            input={{
              "aria-label": uiText.text(en, "message", { value1: personaName }),
              placeholder: isMobile ? (uiText.text(en, "askYourAssistant")) : (uiText.text(en, "askAboutYourBaseOperatorsOrNextUpgrade")),
              rows: 1,
              value: draft,
              onChange: (event) => setDraft(event.target.value),
              onCompositionStart: () => { composing.current = true; },
              onCompositionEnd: () => { composing.current = false; },
              onBlur: () => { composing.current = false; },
              onKeyDown: (event) => {
                if (event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault();
                  void submit(draft);
                }
              },
            }}
            attachments={attachments.length ? <div className="flex flex-wrap gap-2 p-1">{attachments.map((file, index) => <AttachmentPreview key={`${file.filename}-${index}`} file={file} onRemove={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</div> : undefined}
            toolbar={<>
              <AgentComposerMenu compact={compact} en={en} personaName={activePersona ? personaPresentation(activePersona, en).name : uiText.text(en, "closure")} onAttach={() => fileInputRef.current?.click()} onPersona={() => setPersonaOpen(true)} attachmentCount={attachments.length}>
                {attachments.map((file, index) => <AttachmentPreview key={`${file.filename}-${index}`} file={file} onRemove={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}
              </AgentComposerMenu>
              <input ref={fileInputRef} type="file" aria-label={uiText.text(en, "attachFiles")} multiple accept="image/*,.md,.markdown,.txt,.json,.pdf,.csv,.xlsx" className="hidden" onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} />
              {!compact ? <Button type="button" variant="ghost" size="icon" className="hidden md:inline-flex size-9 rounded-lg text-muted-foreground" aria-label={uiText.text(en, "addAttachment")} title={uiText.text(en, "addAttachment")} onClick={() => fileInputRef.current?.click()}><Paperclip className="size-4" aria-hidden="true" /></Button> : null}
              <Button type="button" variant="ghost" size="sm" disabled={busy} className={compact ? dialogueStyles.compactPersonaButton : "hidden md:inline-flex max-w-40 rounded-lg text-xs text-muted-foreground"} aria-label={compact ? `${uiText.text(en, "persona")}：${personaName}` : undefined} onClick={() => setPersonaOpen(true)}>{compact ? null : <Settings2 className="size-3.5 shrink-0" aria-hidden="true" />}<span className="truncate">{compact ? personaName : `${uiText.text(en, "persona")}：${personaName}`}</span>{compact ? <ChevronDown className="size-3 shrink-0" aria-hidden="true" /> : null}</Button>
            </>}
          />
          {uploadError ? <p role="alert" className="mt-2 px-1 text-xs text-destructive">{uploadError}</p> : !compact ? <p className="mt-2 hidden flex-wrap justify-between gap-1 px-1 text-[10px] text-muted-foreground md:flex"><span>{uiText.text(en, "upTo4Attachments8MbEach")}</span><span>{uiText.text(en, "enterToSendShiftEnterForANew")}</span></p> : null}
        </> : null}
      >
        <AgentConversationScrollArea floating={compact} onScrollbarPointerDown={onScrollbarPointerDown} className={`${compact ? dialogueStyles.compactConversation : dialogueStyles.conversation} min-h-0 flex-1 bg-transparent`} viewportClassName={`flex min-w-0 flex-col gap-6 overscroll-contain py-3 md:gap-10 md:py-8 ${compact ? "gap-4 py-2 md:gap-5 md:py-2" : ""}`} viewportProps={{ ref: conversationRef,
          onScroll: (event) => { if (event.currentTarget.scrollTop <= 0) setHeaderHidden(false); },
          onWheel: (event) => readingGesture(event.deltaY),
          onTouchStart: (event) => { touchY.current = event.touches[0]?.clientY ?? null; },
          onTouchMove: (event) => { const y = event.touches[0]?.clientY; if (y !== undefined && touchY.current !== null && Math.abs(touchY.current - y) > 12) { readingGesture(touchY.current - y); touchY.current = y; } },
          onTouchEnd: () => { touchY.current = null; },
          onKeyDown: (event) => { if (event.target === event.currentTarget) { if (event.key === "PageDown" || event.key === "ArrowDown") readingGesture(20); if (["PageUp", "ArrowUp", "Home"].includes(event.key)) readingGesture(-20); } },
          role: "region", "aria-label": uiText.text(en, "conversation"), "aria-busy": busy }}>
          {agentStatus === "loading" ? <div className={dialogueStyles.activity}><LoadingState label={uiText.text(en, "connectingToClosure")} /></div> : null}
          {agentStatus === "unconfigured" ? <div className="my-auto grid justify-items-start gap-3 text-sm"><Bot className="size-6 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">{uiText.text(en, "assistantIsNotAvailableYet")}</h2><p className="text-muted-foreground">{uiText.text(en, "theModelConnectionNeedsToBeConfiguredPlease")}</p></div> : null}
          {agentStatus === "unavailable" ? <div role="alert" className="my-auto grid justify-items-start gap-3 text-sm"><h2 className="font-medium">{uiText.text(en, "couldNotConnectToTheAssistant")}</h2><p className="text-muted-foreground">{uiText.text(en, "pleaseRefreshThePageAndTryAgain")}</p></div> : null}
          {agentStatus === "unauthenticated" ? <div className="my-auto grid justify-items-start gap-3 text-sm"><Bot className="size-6 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">{uiText.text(en, "signInToMeetClosure")}</h2><p className="text-muted-foreground">{uiText.text(en, "useYourWebsiteAccountToAccessTheAssistant")}</p><Button onClick={event => requestAccountSignIn(event.currentTarget)} size="sm" className="h-9 rounded-full px-4">{uiText.text(en, "signIn")}</Button></div> : null}
          {agentStatus === "payment_required" ? <div className="my-auto grid justify-items-start gap-3 text-sm"><h2 className="font-medium">{uiText.text(en, "addCreditsToGetStarted")}</h2><p className="text-muted-foreground">{uiText.text(en, "youNeedAtLeast1CreditToUse")}</p>{billingAllowed ? <Button nativeButton={false} render={<Link to="/billing" />} size="sm" className={billingStyles.pill}>{uiText.text(en, "viewPaymentPlans")}</Button> : null}</div> : null}

          {messages.length === 0 && agentStatus === "ready" ? <div className={compact ? dialogueStyles.compactWelcome : "my-auto grid gap-5 py-4 sm:py-8"} data-agent-welcome>
            {compact ? <>
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">{uiText.text(en, "pageGuide")}</p>
                <h2 className="text-xl font-medium tracking-tight">{pageContext?.title ?? (uiText.text(en, "currentPage"))}</h2>
              </div>
              {pageContext && sharePageContext ? <div className={dialogueStyles.compactContextCard} data-agent-page-guide>
                <p className={dialogueStyles.compactContextCardTitle}><FileText size={13} aria-hidden="true" />{uiText.text(en, "pageSummaryIsShared")}</p>
                {pageGuideLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
              </div> : <p className="text-sm leading-6 text-muted-foreground" data-agent-page-guide>{!sharePageContext ? (uiText.text(en, "pageSharingIsOffOnlyYourMessageWill")) : (uiText.text(en, "thePageSummaryIsUnavailableYouCanStill"))}</p>}
              <p className="text-sm leading-6 text-muted-foreground">{uiText.text(en, "askAboutTheCurrentShiftRoomAssignmentsOr")}</p>
            </> : <>
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">{uiText.text(en, "liveConversation")}</p>
                <h2 className="text-xl font-medium tracking-tight">{activePersona?.kind === "builtin" ? personaPresentation(activePersona, en).welcome : (uiText.text(en, "whatWouldYouLikeToKnow"))}</h2>
              </div>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground">{uiText.text(en, "askDirectlyAboutYourAccountOperatorsOrBase")}</p>
            </>}
          </div> : null}

          {displayTurns.map((turn) => {
            if (turn.kind === "user") {
              const message = turn.message;
              const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
              return <ChatBubble key={turn.key} speaker="user" name={userName?.trim() || (uiText.text(en, "doctor"))} avatar={userId ? <FluidOrb size={38} color={accountOrbColor(userId)} style={{ width: "100%", height: "100%" }} data-account-orb-color={accountOrbColor(userId)} /> : undefined}>
              {message.parts.some((part) => part.type === "file") ? <div className="mb-2 flex flex-wrap gap-2">{message.parts.filter((part) => part.type === "file").map((part, index) => <AttachmentPreview key={index} file={part} />)}</div> : null}
              {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
            </ChatBubble>;
            }
            const waiting = turn.pending && (status === "submitted" || !hasActiveAgentContent(turn.messages.at(-1)));
            const builtin = builtinAgentPersona(turn.persona.mascot);
            const personaName = builtin ? personaPresentation(builtin, en).name : turn.persona.name ?? uiText.text(en, "closure");
            const personaAvatar = turn.persona.avatarUrl;
            const personaMascot = turn.persona.mascot;
            return <div key={turn.key} className={dialogueStyles.assistantTurn} data-agent-assistant-turn data-response-key={turn.key} data-pending={turn.pending}>
              {turn.messages.flatMap((message) => {
                const active = turn.pending && status !== "submitted" && message.id === messages.at(-1)?.id;
                const animate = !restoredMessageIds.has(message.id);
                const activeAvatarIndex = active ? message.parts.reduce((last, part, index) =>
                  part.type === "text" && part.state === "streaming" && !!part.text.trim() ? index : last, -1) : -1;
                return message.parts.map((part, partIndex) => {
                const key = `${message.id}:${partIndex}`;
                if (part.type === "text") return part.text.trim() ? <ChatBubble key={key} speaker="assistant" name={personaName} label={uiText.text(en, "reply", { value1: personaName })} avatar={<PersonaAvatar name={personaName} src={personaAvatar} mascot={personaMascot} active={partIndex === activeAvatarIndex} />}><StreamingText content={INTERNAL_ANSWER_MARKERS.test(part.text) ? (uiText.text(en, "thisSavedReplyContainsInvalidFormattingPleaseAsk")) : part.text} running={active && part.state === "streaming"} animate={animate} previousParts={message.parts.slice(0, partIndex).flatMap((previous) => previous.type === "text" && !INTERNAL_ANSWER_MARKERS.test(previous.text) ? [previous.text] : [])} /></ChatBubble> : null;
                if (part.type === "reasoning") return part.text.trim() || (active && part.state === "streaming") ? <div key={key} className={dialogueStyles.activity}><ThinkingState label={uiText.text(en, "thinking")} activeLabel={uiText.text(en, "thinking2")} running={active && part.state === "streaming"} animate={animate}>{part.text}</ThinkingState></div> : null;
                if (isToolPart(part)) {
                  // Keep every completed schedule in its original conversation position,
                  // including restored history, with an action that can be used again.
                  const output = asRecord(part.output);
                  const handoff = part.type === "tool-solve_schedule" && part.state === "output-available" && !output?.error && output?.plan ? agentArtifactFromOutput(part.output) : null;
                  if (handoff) {
                    return <ChatBubble key={key} speaker="assistant" name={personaName} label={uiText.text(en, "generatedSchedule")} avatar={<PersonaAvatar name={personaName} src={personaAvatar} mascot={personaMascot} active={partIndex === activeAvatarIndex} />}>
                      <p className="mb-3 text-sm leading-6">{intl("App.agentArtifactBannerText", { preset: handoff.preset ? `（${handoff.preset}）` : "" })}</p>
                      <ToolResultSummary name="solve_schedule" output={part.output} openLabel={intl("App.agentArtifactOpen")} />
                    </ChatBubble>;
                  }
                  return <div key={key} className={dialogueStyles.activity}><AgentToolCard part={part} active={active} animate={animate} /></div>;
                }
                return null;
                });
              })}
              {waiting ? <div key="waiting" className={dialogueStyles.activity}><LoadingState label={uiText.text(en, "workingOnYourRequest")} /></div> : null}
            </div>;
          })}
          {error ? <div role="alert" className="grid justify-items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm"><p className="break-words text-destructive">{agentChatErrorMessage(error.message, en)}</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => { void retryAnswer(); }}><RotateCcw className="size-3.5" aria-hidden="true" />{uiText.text(en, "tryAgain")}</Button></div> : null}
        </AgentConversationScrollArea>
      </ChatPanel>

      <Dialog open={personaOpen} onOpenChange={(open) => { if (!avatarSaving) setPersonaOpen(open); }}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-[min(1160px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{rawText.text(rawLocale, "persona")}</DialogTitle></DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto overscroll-contain pb-5 sm:pb-7">
            <div className="grid gap-3">
              <div className={personaStyles.cards}>
              {[null, ...builtinPersonas, ...(uploadedPersona ? [uploadedPersona] : [])].map((persona) => {
                const selected = (persona?.id ?? null) === (activePersona?.id ?? null);
                const display = persona ? personaPresentation(persona, en) : null;
                const displayName = display?.name ?? uiText.text(en, "closure");
                return <WorkbenchCard key={persona?.id ?? "default"} glass className={`${billingStyles.product} ${personaStyles.preview} ${!persona ? personaStyles.closure : persona.kind === "builtin" ? BUILTIN_PERSONA_THEMES[persona.theme] : ""}`} aria-label={rawText.text(en, selected ? "selectedPersonaPreview" : "personaPreview", { name: displayName })} data-persona-card={persona?.id ?? "default"} data-selected={selected ? "true" : undefined} data-persona-theme={persona?.kind === "builtin" ? persona.theme : undefined} data-persona-avatar-settings={selected ? "" : undefined}>
                <button type="button" className={personaStyles.cardSelect} disabled={avatarSaving || busy} aria-pressed={selected} aria-label={rawText.text(en, "selectPersona", { name: displayName })} onClick={() => { if (!selected) selectPersona(persona); }} />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">{rawText.text(rawLocale, "persona")}</p>
                  <span className={`${billingStyles.productBadge} shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium`}>{persona?.kind === "builtin" ? rawText.text(rawLocale, "builtInPersonas") : persona ? rawText.text(rawLocale, "localPersonas") : rawText.text(rawLocale, "defaultPersona")}</span>
                </div>
                <div className={personaStyles.identity}>
                  <div className={personaStyles.portrait} aria-hidden="true"><PersonaAvatar name={displayName} src={persona?.kind === "upload" ? persona.avatarUrl : undefined} mascot={persona?.kind === "builtin" ? persona.avatar : undefined} size={80} /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className={personaStyles.name}>{displayName}</h3>
                    <p className={personaStyles.description}>{display?.description || rawText.text(en, "defaultPersonaDescription")}</p>
                  </div>
                </div>
                {persona?.kind === "upload" ? <div>
                  <p className={billingStyles.caption}>{rawText.rich(rawLocale, "avatarSavedInThisBrowserPngJpegWebpUp", { part1: richValue((<br />)) })}</p>
                  <div className={personaStyles.actions}>
                    <Button type="button" className={`${billingStyles.pill} ${billingStyles.primary}`} disabled={avatarSaving} onClick={() => personaAvatarInputRef.current?.click()}><Upload className="size-3.5" aria-hidden="true" />{avatarSaving ? rawText.text(rawLocale, "saving") : rawText.text(rawLocale, "uploadAvatar")}</Button>
                    <Button type="button" variant="ghost" className={billingStyles.pill} disabled={avatarSaving || !persona.avatarUrl} onClick={() => updatePersonaAvatar()}>{rawText.text(rawLocale, "resetAvatar")}</Button>
                  </div>
                    <p className={`${billingStyles.caption} mt-3 break-words`}>{rawText.rich(rawLocale, "savedInThisBrowserAndSelectedTheNextTime", { part1: richValue((persona.filename)) })}</p>
                    <Button type="button" variant="link" size="sm" disabled={avatarSaving || busy} className="mt-1 h-auto px-0 text-xs text-muted-foreground" onClick={() => { clearLocalPersona(); setUploadedPersona(null); if (selected) selectPersona(null); }}>{rawText.text(rawLocale, "removeLocalPersonaCard")}</Button>
                </div> : <div>
                  <p className={billingStyles.caption}>{display?.caption || rawText.text(rawLocale, "useThePersonaCurrentlyConfiguredOnTheServer")}</p>
                </div>}
              </WorkbenchCard>;
              })}
              {!uploadedPersona ? <WorkbenchCard glass className={`${billingStyles.product} ${personaStyles.preview}`} aria-label={rawText.text(rawLocale, "importPersonaCard")}>
                <div>
                  <Upload className="mb-5 size-6 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-lg font-semibold">{rawText.text(rawLocale, "addYourPersonaCard")}</h3>
                  <p className={personaStyles.description}>{rawText.text(rawLocale, "importAStyleYouLikeAndCreateYourOwn")}</p>
                </div>
                <div>
                  <p className={billingStyles.caption}>{rawText.rich(rawLocale, "markdownTxtJsonUpTo36KbSavedIn", { part1: richValue((<br />)) })}</p>
                  <Button type="button" variant="outline" className={`${billingStyles.pill} mt-3 w-full`} disabled={avatarSaving} onClick={() => personaInputRef.current?.click()}>{rawText.rich(rawLocale, "uploadPersonaCard", { part1: richValue((<Upload className="size-4" aria-hidden="true" />)) })}</Button>
                </div>
              </WorkbenchCard> : null}
              </div>
              {uploadedPersona ? <input ref={personaAvatarInputRef} aria-label={rawText.text(rawLocale, "uploadPersonaAvatar")} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={avatarSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPersonaAvatar(file); event.currentTarget.value = ""; }} /> : null}
              <input ref={personaInputRef} aria-label={rawText.text(rawLocale, "uploadPersonaFile")} type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" className="hidden" disabled={avatarSaving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPersona(file); event.currentTarget.value = ""; }} />
              {uploadedPersona ? <Button type="button" variant="outline" disabled={avatarSaving} className={`${billingStyles.pill} justify-self-start`} onClick={() => personaInputRef.current?.click()}>{rawText.rich(rawLocale, "uploadPersonaCard", { part1: richValue((<Upload className="size-4" aria-hidden="true" />)) })}</Button> : null}
              {personaError ? <p role="alert" className="text-xs text-destructive">{personaError}</p> : null}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </section>
  );
}
