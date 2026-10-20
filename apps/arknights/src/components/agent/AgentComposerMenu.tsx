"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Paperclip, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AgentComposerMenu({ en, personaName, onAttach, onPersona, attachmentCount, children }: {
  en: boolean; personaName: string; onAttach: () => void; onPersona: () => void;
  attachmentCount: number; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger render={<Button variant="ghost" size="icon" />} className="relative size-11 shrink-0 rounded-full md:hidden" aria-label={en ? `Attachments and persona${attachmentCount ? `, ${attachmentCount} attachments` : ""}` : `附件与人格卡${attachmentCount ? `，${attachmentCount} 个附件` : ""}`}>
      <Plus className="size-5" aria-hidden="true" />
      {attachmentCount > 0 ? <span className="absolute right-0 top-0 grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{attachmentCount}</span> : null}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="top" align="start" sideOffset={10} className="z-50">
        <Popover.Popup className="grid w-72 max-w-[calc(100vw-24px)] gap-2 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
          <Popover.Title className="sr-only">{en ? "Attachments and persona" : "附件与人格卡"}</Popover.Title>
          <Button variant="ghost" className="min-h-11 justify-start rounded-xl" onClick={() => { onAttach(); setOpen(false); }}><Paperclip className="size-4" />{en ? "Add attachment" : "添加附件"}</Button>
          <p className="px-3 text-xs text-muted-foreground">{en ? "Up to 4 attachments · 8 MB each" : "最多 4 个附件 · 单个 ≤ 8 MB"}</p>
          {attachmentCount > 0 ? <div className="grid max-h-48 gap-2 overflow-y-auto p-1">{children}</div> : null}
          <Button variant="ghost" className="min-h-11 justify-start rounded-xl" onClick={() => { setOpen(false); onPersona(); }}><Settings2 className="size-4 shrink-0" /><span className="truncate">{en ? "Persona" : "人格卡"}：{personaName}</span></Button>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
