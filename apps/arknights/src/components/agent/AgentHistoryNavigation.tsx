"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_agent_AgentHistoryNavigation.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_agent_AgentHistoryNavigation");


import { useId } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useLocale } from "use-intl";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useAgentRunningConversations } from "./AgentRuntimeProvider";
import { SidebarMenuAction, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar } from "@/components/ui/sidebar";

export function AgentHistoryNavigation({ active }: { active: boolean }) {
  const en = useLocale();
  const { ready, owner, history, store, error } = useAgentHistory();
  const runningIds = useAgentRunningConversations(owner);
  const { state, isMobile, setOpenMobile } = useSidebar();
  const contentId = useId();
  if (!ready || !owner) return null;
  const expanded = history.expanded && (isMobile || state !== "collapsed");
  const label = expanded ? (uiText.text(en, "collapseChatHistory")) : (uiText.text(en, "expandChatHistory"));
  return <>
    <SidebarMenuAction data-agent-history-toggle aria-label={label} title={label} aria-expanded={expanded} aria-controls={contentId} onClick={store.toggleExpanded}>
      <ChevronDown aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${expanded ? "" : "-rotate-90"}`} />
    </SidebarMenuAction>
    <div id={contentId} data-agent-history hidden={!expanded}>
      <SidebarMenuSub>
        {history.conversations.map((conversation) => <SidebarMenuSubItem key={conversation.id}>
          <SidebarMenuSubButton render={<Link to="/agent" />} title={conversation.title} aria-label={conversation.title} aria-current={active && history.activeId === conversation.id ? "page" : undefined} isActive={active && history.activeId === conversation.id} onClick={() => {
            store.select(conversation.id);
            if (isMobile) setOpenMobile(false);
          }}>
            <span className="min-w-0 truncate">{conversation.title}</span>
            {runningIds.includes(conversation.id) ? <span data-agent-history-loading={conversation.id} role="status" aria-label={uiText.text(en, "generatingReply")}><Loader2 aria-hidden="true" /></span> : null}
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>)}
      </SidebarMenuSub>
      <p className="px-4 py-1 text-[10px] leading-4 text-muted-foreground">{error ? (uiText.text(en, "historyCouldNotBeSavedKeepThisPage")) : history.conversations.length ? (uiText.text(en, "thisBrowserLatest5Chats")) : (uiText.text(en, "yourChatsWillAppearHere"))}</p>
    </div>
  </>;
}
