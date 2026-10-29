"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_workbench_GachaHistoryRoute.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_workbench_GachaHistoryRoute");


import { useLocale } from "use-intl";
import { Link } from "@tanstack/react-router";
import GachaHistoryPage from "@/components/pages/GachaHistoryPage";
import { WebsiteAccountPanel } from "@/components/auth/WebsiteAccountPanel";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkbench } from "@/workbench-context";
import { useWebsiteSession } from "@/website-session";
import { SetupActionButton } from "@/components/setup/SetupActionButton";

export function GachaHistoryRoute() {
  const { account, skland: center } = useWorkbench();
  const { data: session } = useWebsiteSession();
  const en = useLocale();
  if (account.pending) return <Skeleton className="h-64 w-full" />;
  if (!account.authenticated) return <main className="w-full min-w-0 space-y-5 pt-5" data-gacha-login-required>
    <WorkbenchPageHeading page="gacha">{uiText.text(en, "gachaAnalysis")}</WorkbenchPageHeading>
    <p className="text-sm text-muted-foreground">{uiText.text(en, "signInToYourWebsiteAccountThenScan")}</p>
    <WebsiteAccountPanel onSessionChanged={account.onSessionChanged} />
  </main>;
  const skland = center?.skland;
  if (skland?.sessionLoading) return <Skeleton className="h-64 w-full" />;
  const activeAccount = skland?.accounts.find((item) => item.accountId === skland.activeAccountId) ?? skland?.accounts[0];
  const role = activeAccount?.roles.find((item) => item.uid === activeAccount.selectedUid) ?? activeAccount?.roles[0];
  if (!skland || !activeAccount || !role) return <main className="w-full min-w-0 space-y-5 pt-5" data-gacha-history>
    <WorkbenchPageHeading page="gacha">{uiText.text(en, "gachaAnalysis")}</WorkbenchPageHeading>
    <p className="text-sm text-muted-foreground">{uiText.text(en, "selectAnAccountInSklandSyncToView")}</p>
    <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0" render={<Link to="/skland" />}>{uiText.text(en, "goToSklandSync")}</SetupActionButton>
  </main>;
  const snapshot = skland.snapshot?.player.uid === role.uid ? skland.snapshot : null;
  if (!snapshot && !skland.error) return <Skeleton className="h-64 w-full" />;
  return <GachaHistoryPage key={`${session?.user.id}:${activeAccount.accountId}:${role.uid}`}
    uid={role.uid} accountId={activeAccount.accountId}
    player={snapshot?.player ?? { ...role, avatarUrl: null, level: null }}
    syncedAt={snapshot?.infrastructure.storeTs ?? null} onCopyUid={skland.onCopyUid}
    identityError={snapshot ? null : skland.error?.message} onRetryIdentity={skland.onRetryStatus} />;
}
