"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { acceptAccountDataConsent, getAccountDataConsent, getCloudWorkspace, putCloudWorkspace } from "@/api";
import { CloudSyncSession, type CloudSyncStatus, type CloudUpload } from "@/cloud-sync-session";
import { cloudSyncPreferenceKey, type CloudSyncStatus as SyncPhase } from "@/cloud-sync";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal-policy";
import type { CloudWorkspaceData } from "@/types";
import { DataConsentDialog } from "./DataConsentDialog";

export function CloudDataSync(props: {
  userId: string | null;
  hasLocalSession: boolean;
  workspace: CloudUpload;
  refreshKey: number;
  onApply: (workspace: CloudWorkspaceData) => void;
  onWorkspaceChanged: (workspace: CloudWorkspaceData | null) => void;
  onStatusChanged: (status: SyncPhase) => void;
}) {
  const intl = useTranslations();
  const { userId, workspace, refreshKey } = props;
  const latest = useRef(props);
  const session = useRef<CloudSyncSession | null>(null);
  const [status, setStatus] = useState<CloudSyncStatus>({ consentOpen: false, saving: false, error: null, errorCode: null, sync: "idle" });
  const [resolution, setResolution] = useState<"local" | "remote" | null>(null);
  useEffect(() => { latest.current = props; });
  useEffect(() => { latest.current.onStatusChanged(status.sync); }, [status.sync]);

  useEffect(() => {
    setStatus({ consentOpen: false, saving: false, error: null, errorCode: null, sync: "idle" });
    if (!userId) {
      latest.current.onWorkspaceChanged(null);
      return;
    }
    const active = new CloudSyncSession({
      userId,
      storage: window.localStorage,
      dismissedKey: `cloud-consent-dismissed:${userId}:${TERMS_VERSION}:${PRIVACY_VERSION}`,
      local: () => latest.current,
      getConsent: getAccountDataConsent,
      acceptConsent: (signal) => acceptAccountDataConsent({ termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }, signal),
      getWorkspace: getCloudWorkspace,
      putWorkspace: putCloudWorkspace,
      apply: (remote) => latest.current.onApply(remote),
      changed: (remote) => latest.current.onWorkspaceChanged(remote),
      status: setStatus,
    });
    session.current = active;
    active.start();
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && event.key === cloudSyncPreferenceKey(userId)) active.refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      active.dispose();
      if (session.current === active) session.current = null;
    };
  }, [userId]);

  useEffect(() => { session.current?.update(); }, [workspace]);
  useEffect(() => { session.current?.refresh(); }, [refreshKey]);
  useEffect(() => { if (status.sync === "local-only") setResolution(null); }, [status.sync]);

  const errorMessages = {
    consent: intl("components_cloud_CloudDataSync.syncError_consent"),
    policy: intl("components_cloud_CloudDataSync.syncError_policy"),
    invalid: intl("components_cloud_CloudDataSync.syncError_invalid"),
    retry: intl("components_cloud_CloudDataSync.syncError_retry"),
    session: intl("components_cloud_CloudDataSync.syncError_session"),
    paused: intl("components_cloud_CloudDataSync.syncError_paused"),
    conflict: intl("components_cloud_CloudDataSync.conflict"),
  };
  const error = status.error ? errorMessages[status.error] : null;
  return <>
    <DataConsentDialog open={status.consentOpen} saving={status.saving} error={error} reloadRequired={status.error === "policy"} onAccept={() => { if (status.error === "policy") window.location.reload(); else void session.current?.accept(); }} onDecline={() => session.current?.decline()} />
    {error && !status.consentOpen ? <Alert data-cloud-sync-error role="status" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-40 mx-auto w-auto max-w-2xl bg-background shadow-lg">
      <AlertDescription className="break-words">
        <p>{error}{status.errorCode ? <> <span className="font-number">({status.errorCode})</span></> : null}</p>
        <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => session.current?.decline()}>{intl("components_cloud_CloudDataSync.useLocalOnly")}</Button>
        {status.error === "paused" || status.error === "consent" ? <Button variant="outline" size="sm" onClick={() => session.current?.retry()}>{intl("components_cloud_CloudDataSync.resumeSync")}</Button> : null}
        {status.error === "conflict" ? <>
          <Button variant="outline" disabled={status.saving} onClick={() => setResolution("remote")}>{intl("components_cloud_CloudDataSync.useRemote")}</Button>
          <Button variant="outline" disabled={status.saving} onClick={() => setResolution("local")}>{intl("components_cloud_CloudDataSync.useLocal")}</Button>
        </> : null}
        </div>
      </AlertDescription>
    </Alert> : null}
    <Dialog open={resolution !== null} onOpenChange={(open) => { if (!open && !status.saving) setResolution(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{intl(resolution === "local" ? "components_cloud_CloudDataSync.useLocal" : "components_cloud_CloudDataSync.useRemote")}</DialogTitle>
          <DialogDescription>{intl(resolution === "local" ? "components_cloud_CloudDataSync.confirmLocal" : "components_cloud_CloudDataSync.confirmRemote")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={status.saving} onClick={() => setResolution(null)}>{intl("components_cloud_CloudDataSync.cancel")}</Button>
          <Button disabled={status.saving} onClick={async () => {
            if (!resolution) return;
            await session.current?.resolveConflict(resolution);
            setResolution(null);
          }}>{intl("components_cloud_CloudDataSync.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
