"use client";

import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type Messages from "../../../messages/zh-CN/AK_components_agent_AgentChat.json";
const text = createLocalizer<typeof Messages>("AK_components_agent_AgentChat");
import { RemoteAvatar } from "@/components/ui/remote-avatar";
import { operatorPortraitFor } from "@/operatorPortraits";
import { FurAvatar } from "./ClosureFurAvatar";

export function PersonaAvatar({ name, src, size = 38, active = false, blank = false, mascot }: { name: string; src?: string; size?: number; active?: boolean; blank?: boolean; mascot?: "silverash" | "exusiai" | "saileach" | "mountain" }) {
  if (blank) return <span className="block size-full rounded-full bg-card" data-persona-avatar-blank />;
  const variant = mascot ?? (name === "可露希尔" || name === "可露希爾" || name === "Closure" ? "closure" : undefined);
  if (!src && variant) return <FurAvatar active={active} variant={variant} surface={size >= 64 ? "portrait" : "chat"} />;
  return <RemoteAvatar
    src={src ?? operatorPortraitFor(name)}
    alt=""
    pixelSize={size}
    className="size-full rounded-full"
    emptyFallback={<span className="grid size-full place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">{Array.from(name.trim())[0] || "?"}</span>}
  />;
}

/** Keep uploaded portraits small enough to persist with the persona in localStorage. */
export async function readPersonaAvatar(file: File, locale: AppLocale): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
    throw new Error(text.text(locale, "avatarSizeError"));
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(text.text(locale, "avatarProcessError"));
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    bitmap.close();
  }
}
