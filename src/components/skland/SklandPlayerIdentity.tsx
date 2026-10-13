"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Clipboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RemoteAvatar } from "@/components/ui/remote-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { localize } from "@/i18n/helpers/components_pages_SklandStatus";
import type { SklandPlayer } from "@/types";

export type SklandPlayerIdentityData = Pick<SklandPlayer, "uid" | "nickname" | "level" | "channelName" | "avatarUrl">;

export function SklandPlayerIdentity({ player, syncedAt, onCopyUid, extraMetadata, nameBadge }: {
  player: SklandPlayerIdentityData; syncedAt: number | null; onCopyUid: (uid: string) => void; extraMetadata?: ReactNode; nameBadge?: ReactNode;
}) {
  const intl = useTranslations();
  const en = useLocale() === "en";
  const date = syncedAt !== null && syncedAt > 0 && Number.isFinite(syncedAt) ? new Date(syncedAt * 1000) : null;
  const syncLabel = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(en ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : localize.text(en, "notProvided");
  const uid = player.uid.length <= 6 ? `${player.uid.slice(0, 2)}••${player.uid.slice(-2)}` : `${player.uid.slice(0, 3)}••••${player.uid.slice(-3)}`;
  const avatarLabel = intl("components_pages_SklandStatus.sSklandAvatar", { nickname: player.nickname });
  return <div className="flex min-w-0 items-center gap-4" data-skland-player-identity>
    <RemoteAvatar src={player.avatarUrl} alt={avatarLabel} pixelSize={56} className="size-14 rounded-xl ring-1 ring-foreground/10" imageClassName="rounded-xl"
      loadingFallback={<Skeleton className="size-full rounded-xl" />}
      emptyFallback={<div className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground" role="img" aria-label={avatarLabel}>{player.nickname.slice(0, 1)}</div>} />
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="truncate text-2xl font-semibold tracking-tight">{player.nickname}</h2>
        {nameBadge}
        {player.level !== null ? <Badge variant="secondary">Lv.{player.level}</Badge> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{player.channelName}</span>
        <button type="button" className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => onCopyUid(player.uid)} aria-label={intl("components_pages_SklandStatus.copyFullUid")}>
          UID {uid} <Clipboard className="size-3" />
        </button>
        <span data-skland-synced-at>{intl("components_pages_SklandStatus.synced2")} {syncLabel}</span>
        {extraMetadata}
      </div>
    </div>
  </div>;
}
