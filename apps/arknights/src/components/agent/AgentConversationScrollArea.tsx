"use client";

import { useEffect, useId, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import styles from "./beautiful/Dialogue.module.css";

/** Keep the conversation viewport intact while its shared scrollbar sits at the window edge. */
export function AgentConversationScrollArea({ floating = false, onScrollbarPointerDown, ...props }: ComponentProps<typeof ScrollArea> & { floating?: boolean; onScrollbarPointerDown?: () => void }) {
  const slotId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (floating) return <ScrollArea {...props} onPointerDownCapture={onScrollbarPointerDown} />;
  return <>
    <ScrollArea {...props} scrollbarSlotId={slotId} />
    {mounted ? createPortal(<div id={slotId} className={styles.pageScrollbar} onPointerDownCapture={onScrollbarPointerDown} data-yeye-scroll-slot-host data-agent-page-scrollbar aria-hidden="true" />, document.body) : null}
  </>;
}
