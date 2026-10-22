"use client";

import { Link } from "@tanstack/react-router";
import { SidebarAccountMenu as SharedAccountMenu } from "@riic/shell/SidebarAccountMenu";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { useLanguageSwitch } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";
import { useWebsiteSession } from "@/website-session";
import { workbenchHref, type AppPage } from "@/workbench-routes";

export function SidebarAccountMenu({ page, onPageChange, onSessionChanged }: {
  page: AppPage;
  onPageChange: (page: AppPage, trigger?: HTMLElement) => boolean;
  onSessionChanged: (authenticated: boolean) => Promise<void>;
}) {
  const language = useLanguageSwitch();
  const { data: session, isPending } = useWebsiteSession();
  const features = useFeatureAccess();
  return <SharedAccountMenu user={session?.user} pending={isPending} language={language} billingEnabled={features.billing} currentPage={page}
    links={{
      billing: <Link to={workbenchHref("billing")} preload={false} />,
      changelog: <Link to="/changelog" preload={false} />,
      docs: <Link to="/docs" data-docs-link />,
      settings: <Link to={workbenchHref("settings")} preload={false} />,
    }}
    onNavigate={(event, destination, trigger) => {
      if ((destination === "billing" || destination === "settings") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
        if (!onPageChange(destination, trigger ?? event.currentTarget)) event.preventDefault();
      }
    }}
    onSignIn={requestAccountSignIn}
    onSignOut={async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      await onSessionChanged(false);
    }}
  />;
}
