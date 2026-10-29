"use client";

import { useTranslations } from "use-intl";
import type messages from "../../messages/zh-CN/Static.json";

export function LocalizedText({ message }: { message: keyof typeof messages }) {
  const t = useTranslations("Static");
  return <>{t(message)}</>;
}
