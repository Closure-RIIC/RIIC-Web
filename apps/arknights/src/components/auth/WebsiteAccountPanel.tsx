"use client";
import { localize as localize_components_auth_WebsiteAccountPanel } from "../../i18n/helpers/components_auth_WebsiteAccountPanel.ts";
import { useTranslations, useLocale } from "use-intl";

import { useId, useState, type ReactNode } from "react";
import {
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { accountOrbColor } from "@/account-orb";
import { cloudSyncMetadataKey } from "@/cloud-sync";
import type { CloudSyncStatus } from "@/cloud-sync";
import { PasswordInput } from "@/components/auth/password-input";
import { WebsiteAccountLoadingStatus } from "@/components/auth/WebsiteAccountDialogLoading";
import {
  InfraTechnicalCard as AccountTechnicalCard,
  InfraTechnicalHeading as AccountTechnicalHeading,
} from "@/components/InfraTechnicalCard";
import { StatusCenterHeader, StatusCenterLoading } from "@/components/pages/StatusCenterShell";
import { SkeletonRouteFallback } from "@/components/ui/skeleton-swap";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/arknights-domain/legal-policy";
import { clearLocalProductData } from "@riic/arknights-domain/persistence";
import { CloudDataPanel } from "@/components/cloud/CloudDataPanel";
import type { CloudWorkspaceData, SavedPlanData } from "@riic/arknights-domain/types";
import { useWebsiteSession } from "@/website-session";

import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { reportAccountActivity } from "@riic/shell/account-activity";
type AccountAction = "signout" | "sessions" | "delete";
const AUTH_PASSWORD_TOGGLE_CLASS = "text-[#737373] hover:text-[#242424] dark:text-[#737373] dark:hover:text-[#242424]";

export interface WebsiteAccountSections {
  headerProfile?: ReactNode;
  profile: ReactNode;
  securityActions?: ReactNode;
  cloudData?: ReactNode;
  deleteAccount?: ReactNode;
}

export interface WebsiteAccountPanelProps {
  onSessionChanged?: (authenticated: boolean) => void | Promise<void>;
  loadingMode?: "page" | "dialog";
  renderSections?: (sections: WebsiteAccountSections) => ReactNode;
  cloudWorkspace?: CloudWorkspaceData | null;
  cloudSyncStatus?: CloudSyncStatus;
  onRestoreSavedPlan?: (plan: SavedPlanData) => void;
  onCloudDataChanged?: () => void;
}

function errorMessage(value: unknown, en: boolean): string {
  return value instanceof Error ? value.message : localize_components_auth_WebsiteAccountPanel.text(en, "somethingWentWrongTryAgainLater");
}

function formatSessionExpiry(value: unknown, locale: "zh" | "en"): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat((locale === "en" ? "en-US" : "zh-CN"), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function WebsiteAccountPanel({
  onSessionChanged,
  loadingMode = "page",
  renderSections,
  cloudWorkspace,
  cloudSyncStatus,
  onRestoreSavedPlan,
  onCloudDataChanged,
}: WebsiteAccountPanelProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const { data: session, isPending, refetch } = useWebsiteSession();
  const [deletePassword, setDeletePassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<AccountAction | null>(null);
  const [deleteLocalData, setDeleteLocalData] = useState(true);
  const fieldId = useId();
  async function notifySessionChanged(authenticated: boolean) {
    if (onSessionChanged) await onSessionChanged(authenticated);
    else await refetch();
  }
  async function runAccountAction(action: AccountAction) {
    setBusyAction(action);
    setError(null);
    try {
      const result = action === "signout"
        ? await authClient.signOut()
        : action === "sessions"
          ? await authClient.revokeSessions()
          : await authClient.deleteUser({ password: deletePassword, callbackURL: location.origin });
      if (result.error) throw new Error(result.error.message);
      if (action === "delete" && deleteLocalData && session?.user.id) {
        try {
          clearLocalProductData(window.localStorage);
          window.localStorage.removeItem(cloudSyncMetadataKey(session.user.id));
          window.localStorage.removeItem(`cloud-consent-dismissed:${session.user.id}:${TERMS_VERSION}:${PRIVACY_VERSION}`);
        } catch {
          // Account deletion has already succeeded; local storage can still be
          // cleared later from the calculator when browser access is restored.
        }
      }
      setDeletePassword("");
      await notifySessionChanged(false);
      reportAccountActivity({
        title: en ? "Sign-in and security" : "登录与安全",
        description: action === "sessions" ? (en ? "Signed out on all devices." : "已退出所有设备。")
          : action === "delete" ? (en ? "Account deleted." : "账号已删除。") : (en ? "Signed out on this device." : "已退出当前设备。"),
      });
    } catch (caught) {
      setError(errorMessage(caught, en));
    } finally {
      setBusyAction(null);
    }
  }

  if (isPending && !session && !error) {
    const loadingContent = loadingMode === "dialog"
      ? <WebsiteAccountLoadingStatus />
      : <SkeletonRouteFallback><StatusCenterLoading label={intl("components_auth_WebsiteAccountPanel.restoringWebsiteAccount")} /></SkeletonRouteFallback>;
    return renderSections ? renderSections({ profile: loadingContent }) : loadingContent;
  }

  if (session) {
    const expiresAt = formatSessionExpiry(session.session.expiresAt, locale);
    const orbColor = accountOrbColor(session.user.id);
    const identity = (
      <div className={renderSections ? "flex min-w-0 items-center gap-2.5" : "flex min-w-0 items-center gap-4"}>
        <FluidOrb
          size={renderSections ? 32 : 56}
          color={orbColor}
          aria-hidden="true"
          data-website-account-avatar
          data-account-orb-color={orbColor}
        />
        <div className="min-w-0">
          <div className={renderSections ? "flex min-w-0 items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>
            <h2 className={renderSections ? "truncate text-sm font-medium" : "truncate text-2xl font-semibold tracking-tight"} title={session.user.name}>{session.user.name}</h2>
            {renderSections
              ? <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" role="img" aria-label={intl("components_auth_WebsiteAccountPanel.emailVerified")} />
              : <Badge variant="secondary"><ShieldCheck />{intl("components_auth_WebsiteAccountPanel.emailVerified")}</Badge>}
          </div>
          <p className={renderSections ? "truncate text-xs leading-5 text-muted-foreground" : "mt-1 break-all text-sm text-muted-foreground"} title={session.user.email}>{session.user.email}</p>
        </div>
      </div>
    );
    const signOutButton = (
      <SetupActionButton
        type="button"
        variant="outline"
        className="!min-w-0 max-w-full max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2"
        disabled={busyAction !== null}
        onClick={() => void runAccountAction("signout")}
        data-account-logout
      >
        <LogOut />{busyAction === "signout" ? (intl("components_auth_WebsiteAccountPanel.signingOut")) : (intl("components_auth_WebsiteAccountPanel.signOutOnThisDevice"))}
      </SetupActionButton>
    );
    const revokeSessionsButton = (
      <Button
        type="button"
        size="dialog"
        className="bg-white text-[#272a2b] hover:bg-white/90"
        disabled={busyAction !== null}
        onClick={() => void runAccountAction("sessions")}
      >
        {busyAction === "sessions" ? (intl("components_auth_WebsiteAccountPanel.revokingSessions")) : (intl("components_auth_WebsiteAccountPanel.signOutEverywhere"))}
      </Button>
    );
    const deleteAccount = (
      <AccountTechnicalCard group="manufacture" className="min-h-64">
        <section className="flex h-full flex-col" aria-labelledby={`${fieldId}-delete`}>
          <AccountTechnicalHeading
            icon={<Trash2 className="size-4" aria-hidden="true" />}
            titleId={`${fieldId}-delete`}
          >
            {intl("components_auth_WebsiteAccountPanel.deleteAccountPermanently")}
          </AccountTechnicalHeading>
          <p className="mt-4 text-sm leading-6 text-white/64">
            {intl("components_auth_WebsiteAccountPanel.yourAccountAndAllSessionsWillBeDeletedImmediately")}
          </p>
          <div className="mt-4 grid gap-1.5">
            <Label className="text-white/72" htmlFor={`${fieldId}-delete-password`}>{intl("components_auth_WebsiteAccountPanel.currentPassword")}</Label>
            <PasswordInput
              id={`${fieldId}-delete-password`}
              className="border-white/22 bg-white text-[#242424] shadow-none placeholder:text-[#737373]"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              minLength={8}
              maxLength={128}
              autoComplete="current-password"
              revealLabel={intl("components_auth_WebsiteAccountPanel.showCurrentPassword")}
              toggleClassName={AUTH_PASSWORD_TOGGLE_CLASS}
            />
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-white/72">
            <input
              type="checkbox"
              checked={deleteLocalData}
              onChange={(event) => setDeleteLocalData(event.target.checked)}
              className="size-4 shrink-0 accent-white"
            />
            {intl("components_auth_WebsiteAccountPanel.alsoClearThisBrowserSLocalWorkspaceAfterDeletion")}
          </label>
          <div className="mt-auto flex justify-end pt-5">
            <Button
              type="button"
              variant="destructive"
              size="dialog"
              disabled={deletePassword.length < 8 || busyAction !== null}
              onClick={() => void runAccountAction("delete")}
            >
              {busyAction === "delete" ? (intl("components_auth_WebsiteAccountPanel.deleting")) : (intl("components_auth_WebsiteAccountPanel.deleteAccountPermanently"))}
            </Button>
          </div>
        </section>
      </AccountTechnicalCard>
    );
    const cloudData = (
      <CloudDataPanel
        userId={session.user.id}
        workspace={cloudWorkspace}
        syncStatus={cloudSyncStatus}
        onRestorePlan={onRestoreSavedPlan}
        onCloudDataChanged={onCloudDataChanged}
      />
    );

    if (renderSections) return renderSections({
      headerProfile: <div className="min-w-0 max-w-full sm:max-w-64" data-website-account-panel data-authenticated="true">{identity}</div>,
      profile: error ? <div className="grid gap-3">
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      </div> : null,
      securityActions: <div className="grid gap-4 border-t border-white/14 pt-5" data-account-action-cards>
        <p className="text-sm leading-6 text-white/64">{en ? "Revoke every session to require all devices to sign in again." : "撤销全部登录会话后，所有设备都需要重新登录。"}</p>
        <div className="flex flex-wrap justify-end gap-3">
          {revokeSessionsButton}
        </div>
      </div>,
      cloudData,
      deleteAccount,
    });

    return (
      <div className="grid gap-6" data-website-account-panel data-authenticated="true">
        <StatusCenterHeader identity={identity} actions={signOutButton} />
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]" data-account-action-cards>
          <AccountTechnicalCard group="control" className="min-h-64">
            <section className="flex h-full flex-col" aria-labelledby={`${fieldId}-devices`}>
              <AccountTechnicalHeading
                icon={<MonitorSmartphone className="size-4" aria-hidden="true" />}
                titleId={`${fieldId}-devices`}
              >
                {intl("components_auth_WebsiteAccountPanel.signedInDevices")}
              </AccountTechnicalHeading>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/64">
                {intl("components_auth_WebsiteAccountPanel.thisSessionSigningOutEverywhereRevokesDatabaseSessionsAnd", { value1: (en) ? (expiresAt ? `expires ${expiresAt}` : "is active") : "", value2: (en) ? "" : (expiresAt ? `将在 ${expiresAt} 到期` : "处于有效状态") })}
              </p>
              <div className="mt-auto flex justify-end pt-5">
                {revokeSessionsButton}
              </div>
            </section>
          </AccountTechnicalCard>
          {deleteAccount}
        </div>
        {cloudData}
      </div>
    );
  }

  const prompt = <div className="grid justify-items-start gap-3" data-website-account-sign-in-prompt>
    <p className="text-sm text-muted-foreground">{intl("components_auth_WebsiteAccountPanel.account")}</p>
    <Button type="button" onClick={event => requestAccountSignIn(event.currentTarget)}>{intl("components_auth_WebsiteAccountPanel.signIn")}</Button>
  </div>;
  return renderSections ? renderSections({ profile: prompt }) : prompt;
}
