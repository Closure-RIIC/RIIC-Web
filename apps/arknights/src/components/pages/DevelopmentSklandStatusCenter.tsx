"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { useTranslations } from "use-intl";
import { Suspense } from "react";

import { LogIn, UserRound } from "lucide-react";

import type { SklandStatusProps } from "@/components/pages/SklandStatus";
import { StatusCenterLoading, StatusCenterPage } from "@/components/pages/StatusCenterShell";
import { Button } from "@/components/ui/button";
import type { SklandBindingSummary } from "@riic/arknights-domain/types";

const SklandStatus = lazyWithMessages(() => import("@/components/pages/SklandStatus").then((module) => ({ default: module.SklandStatus })), "apps/arknights/src/components/pages/SklandStatus.tsx");

export interface DevelopmentSklandStatusCenterProps {
  websiteAuthenticated: boolean;
  websiteSessionPending: boolean;
  bindingSummary: SklandBindingSummary;
  onOpenAccount: () => void;
  skland: Omit<SklandStatusProps, "bindingSummary">;
}

function WebsiteLoginRequired({ onOpenAccount }: { onOpenAccount: () => void }) {
  const intl = useTranslations();

  return (
    <StatusCenterPage data-skland-page data-skland-login-required>
      <header className="max-w-2xl">
        <p className="text-xs font-medium tracking-wide text-primary">{intl("components_pages_DevelopmentSklandStatusCenter.sklandStatus")}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">{intl("components_pages_DevelopmentSklandStatusCenter.signInToYourWebsiteAccount")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {intl("components_pages_DevelopmentSklandStatusCenter.yourSklandConnectionBelongsToTheCurrentWebsiteAccount")}
        </p>
      </header>
      <div className="grid min-h-64 place-items-center border-y border-border/70 py-10 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted">
            <LogIn className="size-5" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">{intl("components_pages_DevelopmentSklandStatusCenter.websiteAccountNotSignedIn")}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {intl("components_pages_DevelopmentSklandStatusCenter.accountManagementAndSklandStatusAreSeparateSignIn")}
          </p>
          <Button type="button" className="mt-5 min-h-11" onClick={onOpenAccount}>
            <UserRound />{intl("components_pages_DevelopmentSklandStatusCenter.goToAccount")}
          </Button>
        </div>
      </div>
    </StatusCenterPage>
  );
}

export function DevelopmentSklandStatusCenter({
  websiteAuthenticated,
  websiteSessionPending,
  bindingSummary,
  onOpenAccount,
  skland,
}: DevelopmentSklandStatusCenterProps) {
  const intl = useTranslations();

  if (websiteSessionPending) {
    return (
      <StatusCenterPage data-skland-page>
        <StatusCenterLoading label={intl("components_pages_DevelopmentSklandStatusCenter.restoringWebsiteAccount")} />
      </StatusCenterPage>
    );
  }

  if (!websiteAuthenticated) return <WebsiteLoginRequired onOpenAccount={onOpenAccount} />;

  return <Suspense fallback={<StatusCenterPage data-skland-page><StatusCenterLoading label={intl("components_pages_DevelopmentSklandStatusCenter.restoringWebsiteAccount")} /></StatusCenterPage>}>
    <SklandStatus {...skland} bindingSummary={bindingSummary} />
  </Suspense>;
}
