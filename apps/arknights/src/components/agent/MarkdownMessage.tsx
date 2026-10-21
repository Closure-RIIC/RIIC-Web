"use client";

import { memo, useMemo, useState } from "react";
import { prepareAgentMarkdown, type InlineToken } from "@/agent-markdown";
import type { OperatorMention } from "@/agent-operator-mentions";
import { StreamedText } from "./beautiful/StreamedText";
import motionStyles from "./beautiful/AgentMotion.module.css";

const EMPTY_PARTS: readonly string[] = [];

const OperatorName = memo(function OperatorName({ mention, text, animate }: { mention: OperatorMention; text: string; animate: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return <span className="mx-1 inline whitespace-nowrap" data-agent-operator={mention.id}>
    <span aria-hidden="true" className={`mr-1 inline-block size-[18px] align-[-3px] ${animate ? loaded ? motionStyles.portraitReveal : "opacity-0" : ""}`} data-agent-operator-portrait>{!failed ? <img src={mention.portrait} alt="" width={18} height={18} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className="size-full rounded-full object-cover" /> : null}</span>{text}
  </span>;
});

function InlineText({ token, animate, animateMentions }: { token: InlineToken; animate: boolean; animateMentions: boolean }) {
  if (!token.mentions.length) return <StreamedText text={token.text} animate={animate} />;
  const parts = token.mentions.map((mention, index) => {
    const before = token.text.slice(token.mentions[index - 1]?.end ?? 0, mention.start);
    return <span key={`${mention.start}:${mention.id}`}>{before}<OperatorName mention={mention} text={token.text.slice(mention.start, mention.end)} animate={animateMentions} /></span>;
  });
  return <>{parts}{token.text.slice(token.mentions.at(-1)!.end)}</>;
}

function renderInline(tokens: InlineToken[], animate: boolean, animateMentions: boolean) {
  return tokens.map((token, index) => {
    const text = <InlineText token={token} animate={animate} animateMentions={animateMentions} />;
    if (token.kind === "code") return <code key={index} className="rounded-md bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[0.1]">{text}</code>;
    if (token.kind === "strong") return <strong key={index}>{text}</strong>;
    if (token.kind === "em") return <em key={index}>{text}</em>;
    if (token.kind === "link") return <a key={index} href={token.href} target="_blank" rel="noreferrer" className="font-medium text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700 dark:text-sky-300">{text}</a>;
    return <InlineText key={index} token={token} animate={animate} animateMentions={animateMentions} />;
  });
}

interface MarkdownMessageProps { content: string; animate?: boolean; animateMentions?: boolean; streaming?: boolean; previousParts?: readonly string[] }
export const MarkdownMessage = memo(function MarkdownMessage({ content, animate = false, animateMentions = false, streaming = false, previousParts = EMPTY_PARTS }: MarkdownMessageProps) {
  const nodes = useMemo(() => prepareAgentMarkdown(content, streaming, previousParts), [content, streaming, previousParts]);
  const inline = (tokens: InlineToken[]) => renderInline(tokens, animate, animateMentions);
  return (
    <div className="agent-markdown min-w-0 text-[15px] leading-7">
      {nodes.map((node, index) => {
        if (node.kind === "heading") {
          const Tag = (["h1", "h2", "h3", "h4"] as const)[Math.min(node.level, 4) - 1] ?? "h4";
          return <Tag key={index} className="mt-4 mb-1.5 font-semibold tracking-tight first:mt-0">{inline(node.text)}</Tag>;
        }
        if (node.kind === "paragraph") return <p key={index} className="my-2 first:mt-0 last:mb-0">{inline(node.text)}</p>;
        if (node.kind === "quote") return <blockquote key={index} className="my-3 border-l-2 border-[#d8aa00] pl-3 text-muted-foreground">{inline(node.text)}</blockquote>;
        if (node.kind === "rule") return <hr key={index} className="my-4 border-border/70" />;
        if (node.kind === "code") return <pre key={index} data-yeye-scroll="x" className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-[#191b1e] p-3 text-[13px] leading-6 text-slate-100 shadow-inner"><code data-language={node.language || undefined}><StreamedText text={node.text} animate={animate} /></code></pre>;
        if (node.kind === "table") return <div key={index} data-yeye-scroll="x" className="my-3 overflow-x-auto rounded-xl border border-border/70"><table className="min-w-full text-left text-sm"><thead className="bg-muted/60"><tr>{node.headers.map((cell, cellIndex) => <th key={cellIndex} className="whitespace-nowrap px-3 py-2 font-semibold">{inline(cell)}</th>)}</tr></thead><tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-border/60">{node.headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top">{inline(row[cellIndex] ?? [])}</td>)}</tr>)}</tbody></table></div>;
        const ListTag = node.kind === "ol" ? "ol" : "ul";
        return <ListTag key={index} className={`${node.kind === "ol" ? "list-decimal" : "list-disc"} my-2 space-y-1 pl-6`}>{node.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{inline(item)}</li>)}</ListTag>;
      })}
    </div>
  );
}, (previous, next) => previous.content === next.content && previous.animate === next.animate && previous.animateMentions === next.animateMentions && previous.streaming === next.streaming
  && (previous.previousParts?.length ?? 0) === (next.previousParts?.length ?? 0)
  && (previous.previousParts ?? EMPTY_PARTS).every((part, index) => part === next.previousParts?.[index]));

export function plainTextFromParts(parts: Array<{ type: string; text?: string }>) {
  return parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}
