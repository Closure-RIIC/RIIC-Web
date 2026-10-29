"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { Suspense } from "react";

import { RichTextStatic } from "@/components/RichTextStatic";

const InteractiveRichText = lazyWithMessages(() =>
  import("@/components/RichTextInteractive").then((module) => ({ default: module.RichTextInteractive })), "apps/arknights/src/components/RichTextInteractive.tsx");

/**
 * 基建技能富文本渲染：`<@cc.xxx>` 上色、`<$cc.xxx>` 渲染为可点击词条。
 * 非交互 tooltip 只加载轻量渲染器；词条目录和弹窗仅在交互场景按需加载。
 */
export function RichText({
  text,
  onTermOpen,
  interactive = true,
}: {
  text: string;
  onTermOpen?: (id: string) => void;
  /** 为 false 时词条只渲染样式、不可点击（用于 tooltip 等弹窗不稳定的容器）。 */
  interactive?: boolean;
}) {
  if (interactive) {
    return <Suspense fallback={<RichTextStatic text={text} />}><InteractiveRichText text={text} onTermOpen={onTermOpen} /></Suspense>;
  }

  return <RichTextStatic text={text} />;
}
