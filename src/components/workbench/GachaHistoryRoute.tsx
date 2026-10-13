"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
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
  const en = useLocale() === "en";
  if (account.pending) return <Skeleton className="h-64 w-full" />;
  if (!account.authenticated) return <main className="w-full min-w-0 space-y-5 pt-5" data-gacha-login-required>
    <WorkbenchPageHeading page="gacha">{en ? "Headhunting history" : "寻访记录"}</WorkbenchPageHeading>
    <p className="text-sm text-muted-foreground">{en ? "Sign in to your website account, then scan to authorize access to headhunting history." : "请先登录网站账号，再扫码授权读取寻访记录。"}</p>
    <WebsiteAccountPanel onSessionChanged={account.onSessionChanged} />
  </main>;
  const skland = center?.skland;
  if (skland?.sessionLoading) return <Skeleton className="h-64 w-full" />;
  const activeAccount = skland?.accounts.find((item) => item.accountId === skland.activeAccountId) ?? skland?.accounts[0];
  const role = activeAccount?.roles.find((item) => item.uid === activeAccount.selectedUid) ?? activeAccount?.roles[0];
  if (!skland || !activeAccount || !role) return <main className="w-full min-w-0 space-y-5 pt-5" data-gacha-history>
    <WorkbenchPageHeading page="gacha">{en ? "Headhunting history" : "寻访记录"}</WorkbenchPageHeading>
    <p className="text-sm text-muted-foreground">{en ? "Select an account in Skland Status to view its headhunting archive. Saved cloud records are retained." : "请先在森空岛状态中心登录并选择账号，寻访记录将跟随该账号显示。已有云端记录会继续保留。"}</p>
    <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0" render={<Link href="/skland" />}>{en ? "Go to Skland Status" : "前往森空岛状态中心"}</SetupActionButton>
  </main>;
  const snapshot = skland.snapshot?.player.uid === role.uid ? skland.snapshot : null;
  if (!snapshot && !skland.error) return <Skeleton className="h-64 w-full" />;
  return <GachaHistoryPage key={`${session?.user.id}:${activeAccount.accountId}:${role.uid}`}
    uid={role.uid} accountId={activeAccount.accountId}
    player={snapshot?.player ?? { ...role, avatarUrl: null, level: null }}
    syncedAt={snapshot?.infrastructure.storeTs ?? null} onCopyUid={skland.onCopyUid}
    identityError={snapshot ? null : skland.error?.message} onRetryIdentity={skland.onRetryStatus} />;
}
