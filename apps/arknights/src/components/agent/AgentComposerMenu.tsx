"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_agent_AgentComposerMenu.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_agent_AgentComposerMenu");
import type { AppLocale } from "@riic/contracts/locale";
import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Paperclip, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AgentComposerMenu({ en, personaName, onAttach, onPersona, attachmentCount, children, compact = false }: {
  en: AppLocale; personaName: string; onAttach: () => void; onPersona: () => void;
  attachmentCount: number; children: ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger render={<Button variant="ghost" size="icon" />} className={`relative shrink-0 rounded-full ${compact ? "size-9" : "size-11 md:hidden"}`} aria-label={uiText.text(en, "attachmentsAndPersona", { count: attachmentCount })}>
      <Plus className="size-5" aria-hidden="true" />
      {attachmentCount > 0 ? <span className="absolute right-0 top-0 grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{attachmentCount}</span> : null}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="top" align="start" sideOffset={10} className="z-50">
        <Popover.Popup className="grid w-72 max-w-[calc(100vw-24px)] gap-2 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
          <Popover.Title className="sr-only">{uiText.text(en, "attachmentsAndPersona2")}</Popover.Title>
          <Button variant="ghost" className="min-h-11 justify-start rounded-xl" onClick={() => { onAttach(); setOpen(false); }}><Paperclip className="size-4" />{uiText.text(en, "addAttachment")}</Button>
          <p className="px-3 text-xs text-muted-foreground">{uiText.text(en, "upTo4Attachments8MbEach")}</p>
          {attachmentCount > 0 ? <div className="grid max-h-48 gap-2 overflow-y-auto p-1">{children}</div> : null}
          <Button variant="ghost" className="min-h-11 justify-start rounded-xl" onClick={() => { setOpen(false); onPersona(); }}><Settings2 className="size-4 shrink-0" /><span className="truncate">{uiText.text(en, "persona")}：{personaName}</span></Button>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
