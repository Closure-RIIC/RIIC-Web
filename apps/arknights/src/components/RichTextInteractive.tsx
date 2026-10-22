"use client";
import { useTranslations, useLocale } from "use-intl";

import { useMemo, useState, type ReactNode } from "react";

import { RichTextStatic } from "@/components/RichTextStatic";
import { parseRichText, type RichTextNode } from "@/components/skill-query/rich-text";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import termCatalogJson from "@riic/arknights-domain/generated/arkntools/term-catalog.json" with { type: "json" };

type TermRecord = { id: string; name: string; desc: string; descText: string };
const TERM_CATALOG = termCatalogJson as Record<string, TermRecord>;

function renderNodes(nodes: readonly RichTextNode[], onTermOpen: (id: string) => void): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.text;
    if (node.type === "style") {
      return (
        <span key={index} className={`riic-rt ${node.className}`}>
          {renderNodes(node.children, onTermOpen)}
        </span>
      );
    }
    const term = TERM_CATALOG[node.id];
    if (!term) {
      return <span key={index}>{renderNodes(node.children, onTermOpen)}</span>;
    }
    return (
      <button
        key={index}
        type="button"
        className="riic-term"
        onClick={() => onTermOpen(node.id)}
      >
        {renderNodes(node.children, onTermOpen)}
      </button>
    );
  });
}

function renderHoverNodes(nodes: readonly RichTextNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.text;
    if (node.type === "style") {
      return (
        <span key={index} className={`riic-rt ${node.className}`}>
          {renderHoverNodes(node.children)}
        </span>
      );
    }
    const term = TERM_CATALOG[node.id];
    if (!term) {
      return <span key={index}>{renderHoverNodes(node.children)}</span>;
    }
    return (
      <span key={index} className="riic-term-hover">
        <span className="riic-term" tabIndex={0}>
          {renderHoverNodes(node.children)}
        </span>
        <span className="riic-term-hover-card" role="tooltip">
          <strong className="block font-semibold">{term.name}</strong>
          <span className="mt-1 block font-normal">
            <RichTextStatic text={term.desc} />
          </span>
        </span>
      </span>
    );
  });
}

/** 仅用于紧凑 tooltip：悬停或聚焦彩色词条时就地显示详情。 */
export function RichTextHoverTerms({ text }: { text: string }) {
  const locale = useLocale();
  const nodes = useMemo(() => parseRichText(text), [text]);
  if (locale === "en") return <RichTextStatic text={text} />;
  return <span className="whitespace-pre-line">{renderHoverNodes(nodes)}</span>;
}

function BuildingTermDialog({
  termStack,
  onTermOpen,
  onClose,
}: {
  termStack: readonly string[];
  onTermOpen: (id: string) => void;
  onClose: () => void;
}) {
  const intl = useTranslations();

  return (
    <Dialog open={termStack.length > 0} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="sm:max-w-[min(560px,calc(100vw-2rem))]"
        data-building-term-dialog
      >
        <DialogHeader className="px-6 pb-1 pt-6 pr-14 sm:px-9 sm:pb-1 sm:pt-8 sm:pr-16">
          <DialogTitle>{intl("components_RichTextInteractive.infrastructureTerms")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-5 px-6 pb-7 pt-4 sm:px-9 sm:pb-9 sm:pt-5">
          {termStack.map((id) => {
            const term = TERM_CATALOG[id];
            if (!term) return null;
            return (
              <div key={id} className="min-w-0 space-y-2">
                <h4 className="text-base font-semibold leading-6">{term.name}</h4>
                <div className="text-pretty leading-6">
                  <RichTextInteractive text={term.desc} onTermOpen={onTermOpen} />
                </div>
              </div>
            );
          })}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** 交互式富文本：包含词条目录、点击处理和词条详情弹窗。 */
export function RichTextInteractive({
  text,
  onTermOpen,
}: {
  text: string;
  onTermOpen?: (id: string) => void;
}) {
  const locale = useLocale();
  const [termStack, setTermStack] = useState<string[]>([]);
  const nodes = useMemo(() => parseRichText(text), [text]);

  if (locale === "en") return <RichTextStatic text={text} />;

  const openTerm = (id: string) => {
    if (onTermOpen) {
      onTermOpen(id);
      return;
    }
    setTermStack((current) => (current.includes(id) ? current : [...current, id]));
  };

  return (
    <>
      <span className="whitespace-pre-line">{renderNodes(nodes, openTerm)}</span>
      {!onTermOpen ? (
        <BuildingTermDialog
          termStack={termStack}
          onTermOpen={openTerm}
          onClose={() => setTermStack([])}
        />
      ) : null}
    </>
  );
}
