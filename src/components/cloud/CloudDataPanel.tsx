"use client";

import { useTranslations, useLocale } from "next-intl";

import { Cloud } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  deleteAccountSavedPlan,
  getAccountDataConsent,
  getAccountSavedPlans,
  revokeAccountDataConsent,
  updateAccountSavedPlan,
} from "@/api";
import { cloudSyncMetadataKey, cloudSyncPreferenceKey } from "@/cloud-sync";
import type { CloudSyncStatus } from "@/cloud-sync";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { InfraTechnicalCard, InfraTechnicalHeading } from "@/components/InfraTechnicalCard";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal-policy";
import type { AccountDataConsentData, CloudWorkspaceData, SavedPlanData } from "@/types";

const CLOUD_PRIMARY_BUTTON_CLASS = "w-full bg-white text-[#272a2b] hover:bg-white/90 sm:w-auto";
const CLOUD_PLAN_BUTTON_CLASS = "min-h-11 px-3 text-white/78 hover:bg-white/10 hover:text-white";

function formatDate(value: string | null, en: boolean): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat((en ? "en-US" : "zh-CN"), { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "—";
}

export function CloudDataPanel({
  userId,
  workspace,
  syncStatus = "idle",
  onRestorePlan,
  onCloudDataChanged,
}: {
  userId: string;
  workspace?: CloudWorkspaceData | null;
  syncStatus?: CloudSyncStatus;
  onRestorePlan?: (plan: SavedPlanData) => void;
  onCloudDataChanged?: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const [consent, setConsent] = useState<AccountDataConsentData | null>(null);
  const [plans, setPlans] = useState<SavedPlanData[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteAnnouncement, setDeleteAnnouncement] = useState("");
  const busyRef = useRef<string | null>(null);
  const panelId = useId();
  const localOnly = syncStatus === "local-only";

  const reload = useCallback(async () => {
    if (localOnly) { setPlans([]); setError(null); return; }
    const next = await getAccountDataConsent();
    setConsent(next);
    setPlans(next.current ? (await getAccountSavedPlans()).plans : []);
  }, [localOnly]);

  useEffect(() => {
    let cancelled = false;
    void reload().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : (intl("components_cloud_CloudDataPanel.failedToLoadCloudDataStatus")));
    });
    return () => { cancelled = true; };
  }, [intl, en, reload, workspace?.revision]);

  useEffect(() => {
    if (!pendingDeleteId || busy === `delete:${pendingDeleteId}`) return;
    const timeout = window.setTimeout(() => {
      setPendingDeleteId(null);
      setDeleteAnnouncement(intl("components_cloud_CloudDataPanel.deleteConfirmationTimedOutThePlanWasNotDeleted"));
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, [intl, busy, en, pendingDeleteId]);

  if (consent && !consent.cloudSyncEnabled) return null;

  async function run(key: string, action: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = key;
    setBusy(key);
    setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : (intl("components_cloud_CloudDataPanel.cloudDataOperationFailed"))); }
    finally {
      busyRef.current = null;
      setBusy(null);
    }
    return true;
  }

  function reopenConsent() {
    window.localStorage.setItem(cloudSyncPreferenceKey(userId), "sync");
    window.localStorage.removeItem(`cloud-consent-dismissed:${userId}:${TERMS_VERSION}:${PRIVACY_VERSION}`);
    onCloudDataChanged?.();
  }

  return (
    <InfraTechnicalCard group="control" className="min-h-64" dataSlot="cloud-workspace-card">
      <section className="flex h-full flex-col" aria-labelledby={`${panelId}-title`} data-cloud-data-panel>
        <InfraTechnicalHeading
          icon={<Cloud className="size-4" aria-hidden="true" />}
          titleId={`${panelId}-title`}
        >
          {intl("components_cloud_CloudDataPanel.accountCloudWorkspace")}
        </InfraTechnicalHeading>
        <p role="status" className="mt-4 max-w-3xl text-sm leading-6 text-white/64">
          {consent?.current && !localOnly
            ? syncStatus === "synced" && workspace?.exists
              ? (intl("components_cloud_CloudDataPanel.syncedLastSync", { value1: (en) ? (formatDate(workspace?.syncedAt ?? null, true)) : "", value2: (en) ? "" : (formatDate(workspace?.syncedAt ?? null, false)) }))
              : intl(`components_cloud_CloudDataSync.status.${syncStatus}`)
            : (intl("components_cloud_CloudDataPanel.localOnlyModeIsActiveExistingDataIsNot"))}
        </p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-cloud-delete-status>{deleteAnnouncement}</p>
        <div className="mt-5 grid gap-5">
          {error && !localOnly ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <section className="flex flex-col items-start gap-4 border-t border-white/14 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-white/64">{intl("components_cloud_CloudDataPanel.localOnlyDescription")}</p>
            {!localOnly ? <Button type="button" size="dialog" className={CLOUD_PRIMARY_BUTTON_CLASS} disabled={busy !== null} onClick={() => void run("local-only", async () => {
              window.localStorage.setItem(cloudSyncPreferenceKey(userId), "local-only");
              onCloudDataChanged?.();
            })}>{intl("components_cloud_CloudDataSync.useLocalOnly")}</Button> : null}
          </section>
          {localOnly || !consent?.current ? (
            <div className="flex flex-col items-start gap-4 border-t border-white/14 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-white/64">{intl("components_cloud_CloudDataPanel.automaticSyncStartsOnlyAfterYouAcceptTheCurrent")}</p>
              <Button type="button" size="dialog" className={CLOUD_PRIMARY_BUTTON_CLASS} disabled={busy !== null} onClick={() => void run("enable", async () => reopenConsent())}>{intl("components_cloud_CloudDataPanel.enableSync")}</Button>
            </div>
          ) : (
            <>
            <section className="grid gap-3" aria-labelledby={`${panelId}-plans-title`}>
              <h3 id={`${panelId}-plans-title`} className="text-xs font-medium tracking-wide text-white/66">{intl("components_cloud_CloudDataPanel.scheduleHistory")}</h3>
              {plans.length ? plans.map((plan) => (
                <div key={plan.id} className="grid gap-3 border border-white/16 bg-black/12 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{plan.title}</p>
                    <p className="font-number mt-1 text-xs leading-5 text-white/64">
                      <time dateTime={plan.updatedAt}>{formatDate(plan.updatedAt, en)}</time>
                    </p>
                    {!plan.calculationContext ? (
                      <p className="mt-1 text-xs leading-5 text-white/64">{intl("components_cloud_CloudDataPanel.calculationSettingsAreMissingThisPlanCannotBeRestored")}</p>
                    ) : !plan.boxMatchesWorkspace ? (
                      <p className="mt-1 text-xs leading-5 text-white/64">{intl("components_cloud_CloudDataPanel.maaBoxDoesNotMatchThisPlanCannotBe")}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 max-sm:justify-start">
                    {pendingDeleteId === plan.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={CLOUD_PLAN_BUTTON_CLASS}
                          disabled={busy !== null}
                          aria-label={intl("components_cloud_CloudDataPanel.cancelDeletingPlan", { title: plan.title })}
                          onClick={() => {
                            setPendingDeleteId(null);
                            setDeleteAnnouncement(intl("components_cloud_CloudDataPanel.cancelledDeletingPlan", { title: plan.title }));
                          }}
                        >
                          {intl("components_cloud_CloudDataPanel.cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="min-h-11 px-3"
                          disabled={busy !== null}
                          aria-label={intl("components_cloud_CloudDataPanel.confirmDeletingPlan", { title: plan.title })}
                          onClick={() => void (async () => {
                            const started = await run(`delete:${plan.id}`, async () => {
                              await deleteAccountSavedPlan(plan.id);
                              await reload();
                              setDeleteAnnouncement(intl("components_cloud_CloudDataPanel.deletedPlan", { title: plan.title }));
                            });
                            if (started) setPendingDeleteId((current) => current === plan.id ? null : current);
                          })()}
                        >
                          {busy === `delete:${plan.id}` ? (intl("components_cloud_CloudDataPanel.deleting")) : (intl("components_cloud_CloudDataPanel.confirmDelete"))}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={CLOUD_PLAN_BUTTON_CLASS}
                          disabled={busy !== null || !plan.calculationContext || !plan.boxMatchesWorkspace}
                          aria-label={intl("components_cloud_CloudDataPanel.restorePlan", { title: plan.title })}
                          onClick={() => onRestorePlan?.(plan)}
                        >
                          {intl("components_cloud_CloudDataPanel.restore")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={CLOUD_PLAN_BUTTON_CLASS}
                          disabled={busy !== null}
                          aria-label={intl("components_cloud_CloudDataPanel.plan", { value1: (en) ? (plan.pinned ? "Unpin" : "Pin") : "", title: plan.title, value3: (en) ? "" : (plan.pinned ? "取消固定" : "固定") })}
                          onClick={() => void run(`pin:${plan.id}`, async () => {
                            await updateAccountSavedPlan(plan.id, !plan.pinned);
                            await reload();
                          })}
                        >
                          {busy === `pin:${plan.id}` ? (intl("components_cloud_CloudDataPanel.updating")) : plan.pinned ? (intl("components_cloud_CloudDataPanel.unpin")) : (intl("components_cloud_CloudDataPanel.pin"))}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="min-h-11 px-3 text-destructive hover:bg-destructive/15 hover:text-destructive"
                          disabled={busy !== null}
                          aria-label={intl("components_cloud_CloudDataPanel.deletePlan", { title: plan.title })}
                          onClick={() => {
                            setPendingDeleteId(plan.id);
                            setDeleteAnnouncement(intl("components_cloud_CloudDataPanel.confirmWhetherToDeletePlan", { title: plan.title }));
                          }}
                        >
                          {intl("components_cloud_CloudDataPanel.delete")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )) : <p className="text-sm leading-6 text-white/64">{intl("components_cloud_CloudDataPanel.generatedSchedulesWillAppearHereAutomatically")}</p>}
            </section>

            <section className="flex flex-col items-start gap-4 border-t border-white/14 pt-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-xs font-medium tracking-wide text-white/66">{intl("components_cloud_CloudDataPanel.revokeSyncAccess")}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/64">{intl("components_cloud_CloudDataPanel.revokingDeletesTheCloudWorkspaceEncryptedBoxScheduleHistory")}</p>
              </div>
              <HoldToConfirm confirmLabel={intl("components_cloud_CloudDataPanel.confirmed")} className="w-full rounded-[22px] border-transparent bg-destructive/10 px-4 text-[13px] font-semibold text-destructive shadow-none hover:bg-destructive/20 sm:min-h-[46px] sm:w-auto sm:min-w-[196px]" disabled={busy !== null} onConfirm={() => void run("revoke", async () => {
                await revokeAccountDataConsent();
                window.localStorage.removeItem(cloudSyncMetadataKey(userId));
                window.localStorage.setItem(`cloud-consent-dismissed:${userId}:${TERMS_VERSION}:${PRIVACY_VERSION}`, "1");
                window.localStorage.setItem(cloudSyncPreferenceKey(userId), "local-only");
                setConsent((current) => current ? { ...current, current: false, revokedAt: new Date().toISOString() } : current);
                setPlans([]);
                onCloudDataChanged?.();
              })}>{intl("components_cloud_CloudDataPanel.holdToRevokeAndDelete")}</HoldToConfirm>
            </section>
            </>
          )}
        </div>
      </section>
    </InfraTechnicalCard>
  );
}
