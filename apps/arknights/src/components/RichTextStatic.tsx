"use client";

import { useMemo, type ReactNode } from "react";

import { parseRichText, type RichTextNode } from "@/components/skill-query/rich-text";

function renderStaticNodes(nodes: readonly RichTextNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.text;
    if (node.type === "style") {
      return (
        <span key={index} className={`riic-rt ${node.className}`}>
          {renderStaticNodes(node.children)}
        </span>
      );
    }
    return (
      <span key={index} className="riic-term riic-term-static">
        {renderStaticNodes(node.children)}
      </span>
    );
  });
}

/** 只渲染富文本样式，不加载可点击词条目录或弹窗。 */
export function RichTextStatic({ text }: { text: string }) {
  const nodes = useMemo(() => parseRichText(text), [text]);
  return <span className="whitespace-pre-line">{renderStaticNodes(nodes)}</span>;
}
