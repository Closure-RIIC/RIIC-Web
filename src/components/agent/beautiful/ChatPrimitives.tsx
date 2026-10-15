"use client";

// Adapted from Beautiful UI's Chat, Loading State, Thinking, Streaming Text and Tool Chips.
// https://www.beautifului.dev/ — Copyright (c) 2026 Shane Levine, MIT.
// See LICENSE.txt. Demo timers/data replaced with controlled application state.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowUp, Check, ChevronDown, CircleAlert, Loader2, Square } from "lucide-react";
import { MarkdownMessage } from "../MarkdownMessage";
import { ReasoningPreview } from "./ReasoningPreview";
import styles from "./AgentMotion.module.css";
import dialogue from "./Dialogue.module.css";

export function ChatPanel({ children, composer }: { children: ReactNode; composer: ReactNode }) {
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-transparent" data-agent-panel>
    {children}
    {composer ? <div className={`${styles.composerEnter} relative z-10 shrink-0 pt-2 md:px-4 md:pb-3 md:pt-4`} data-agent-composer>{composer}</div> : null}
  </div>;
}

export function ChatBubble({ children, name, speaker, label, avatar }: { children: ReactNode; name: string; speaker: "user" | "assistant"; label?: string; avatar?: ReactNode }) {
  return <article className={dialogue.row} data-speaker={speaker} aria-label={label}>
    <div className={dialogue.avatar} aria-hidden="true" data-agent-avatar>{avatar}</div>
    <div className={dialogue.bubble} data-agent-bubble>
      <div className={dialogue.decoration} aria-hidden="true" data-agent-glass />
      <p className={dialogue.name} data-agent-speaker-name>{name}</p>
      <div className={dialogue.body}>{children}</div>
      <span className={dialogue.signal} aria-hidden="true"><i /><i /><i /></span>
    </div>
  </article>;
}

function useElapsed(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  return elapsed;
}

const ElapsedTime = memo(function ElapsedTime({ running }: { running: boolean }) {
  const elapsed = useElapsed(running);
  return elapsed > 0 ? <span aria-hidden="true" className="font-number text-[10px] tabular-nums text-muted-foreground/70" data-agent-elapsed>{elapsed.toFixed(1)}s</span> : null;
});

function LoadingIcon() {
  return <span className={styles.grid} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} className={styles.pixel} style={{ animationDelay: `${(index % 3 + Math.abs(Math.floor(index / 3) - 1)) * 90}ms` }} />)}</span>;
}

export function LoadingState({ label }: { label: string }) {
  return <div role="status" data-agent-loading className="flex min-h-7 items-center gap-1.5 px-1.5 py-1 text-[11px] text-muted-foreground">
    <LoadingIcon />
    <span className={styles.shimmer}>{label}</span>
    <ElapsedTime running />
  </div>;
}

function Disclosure({ id, expanded, children }: { id: string; expanded: boolean; children: ReactNode }) {
  return <div id={id} className={styles.disclosure} data-expanded={expanded} hidden={!expanded}>
    <div className={styles.disclosureInner}>{children}</div>
  </div>;
}

export const ThinkingState = memo(function ThinkingState({ label, activeLabel, running = false, animate = false, children }: { label: string; activeLabel: string; running?: boolean; animate?: boolean; children: string }) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? running;
  const contentId = useId();
  return <div className={`min-w-0 text-[11px] leading-4 text-muted-foreground ${animate ? styles.enter : ""}`} data-agent-thinking data-running={running}>
    <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setManualExpanded(!expanded)} className="flex min-h-7 w-fit items-center gap-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      <span key={running ? "working" : "done"} aria-hidden="true" className={animate ? styles.settle : undefined}>{running ? <LoadingIcon /> : <Check className="size-3.5" />}</span>
      <span className={running ? styles.shimmer : undefined}>{running ? activeLabel : label}</span>
      <ElapsedTime running={running} />
      <ChevronDown className={`size-3.5 ${styles.chevron} ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />
    </button>
    <Disclosure id={contentId} expanded={expanded}>
      {expanded ? <ReasoningPreview text={children} running={running} expanded={expanded} animate={animate} /> : null}
    </Disclosure>
  </div>;
});

export function StreamingText({ content, running, animate, previousParts }: { content: string; running: boolean; animate: boolean; previousParts?: readonly string[] }) {
  return <div className={`min-w-0 text-sm leading-7 [overflow-wrap:anywhere] ${styles.streaming}`} data-agent-streaming-text data-streaming={running}>
    <MarkdownMessage content={content} animate={animate && running} animateMentions={animate} streaming={running} previousParts={previousParts} />
  </div>;
}

export function ToolChip({ label, running, failed, name, animate = false, children }: { label: string; running: boolean; failed: boolean; name: string; animate?: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const statusIcon = running ? <Loader2 className={`size-3.5 ${styles.spin}`} /> : failed ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" />;
  const content = <><span key={running ? "running" : failed ? "failed" : "done"} aria-hidden="true" className={`${failed ? "text-destructive" : "text-muted-foreground"} ${animate ? styles.settle : ""}`}>{statusIcon}</span><span className={`min-w-0 flex-1 break-words ${running ? styles.shimmer : ""}`}>{label}</span>{children ? <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground ${styles.chevron} ${expanded ? "rotate-180" : ""}`} /> : null}</>;
  const rowClass = `inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] leading-4 transition-colors ${failed ? "border-destructive/25 bg-destructive/5 text-destructive" : "border-border/70 bg-muted/50 text-foreground"}`;
  return <div className={`min-w-0 ${animate ? styles.enter : ""}`} data-agent-tool={name} data-running={running}>
    {children ? <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)} className={`${rowClass} hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring`}>{content}</button> : <div className={rowClass}>{content}</div>}
    {children ? <Disclosure id={contentId} expanded={expanded}><div className={`${styles.toolDetails} mt-1 ml-1.5 min-w-0 border-l border-border py-0.5 pl-3`}>{children}</div></Disclosure> : null}
  </div>;
}

type PromptBarProps = {
  input: ComponentProps<"textarea">;
  attachments?: ReactNode;
  toolbar: ReactNode;
  busy: boolean;
  disabled: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend: () => void;
  onStop: () => void;
  onDrop: ComponentProps<"div">["onDrop"];
};

export function PromptBar({ input, attachments, toolbar, busy, disabled, sendLabel, stopLabel, onSend, onStop, onDrop }: PromptBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const scrollTop = textarea.scrollTop;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.scrollTop = scrollTop;
  }, []);
  useLayoutEffect(resize, [input.value, resize]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let width = textarea.clientWidth;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== width) { width = textarea.clientWidth; schedule(); }
    });
    observer.observe(textarea);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [resize]);
  return <div className={`${dialogue.prompt} relative flex min-w-0 flex-col gap-2 p-3 sm:p-4 focus-within:ring-2 focus-within:ring-ring/25`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} data-agent-prompt-bar>
    <div className={dialogue.promptDecoration} aria-hidden="true" data-agent-glass />
    {attachments ? <div className="hidden md:block">{attachments}</div> : null}
    <textarea {...input} ref={textareaRef} className={dialogue.promptInput} />
    <div className={dialogue.promptControls}>
      <div className={dialogue.promptTools}>{toolbar}</div>
      <button type="button" aria-label={busy ? stopLabel : sendLabel} title={busy ? stopLabel : sendLabel} disabled={!busy && disabled} onClick={busy ? onStop : onSend} className={`${dialogue.sendButton} flex size-10 shrink-0 items-center justify-center rounded-full transition-[filter,transform] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:active:scale-95 motion-reduce:transition-none`}>
        {busy ? <Square className="size-3.5 fill-current" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
