"use client";
import { useTranslations } from "use-intl";

import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DataConsentDialog({
  open,
  saving,
  error,
  reloadRequired = false,
  onAccept,
  onDecline,
}: {
  open: boolean;
  saving: boolean;
  error: string | null;
  reloadRequired?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const intl = useTranslations();

  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onDecline(); }}>
      <DialogContent
        data-cloud-consent-dialog
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{intl("components_cloud_DataConsentDialog.enableAccountCloudWorkspace")}</DialogTitle>
          <DialogDescription>
            {intl("components_cloud_DataConsentDialog.afterYouConsentTheSiteAutomaticallySyncsYourMaa")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 gap-4 overflow-y-auto overscroll-contain py-2 text-sm leading-6 text-muted-foreground sm:py-3">
          <ul className="list-disc space-y-1 pl-5">
            <li>{intl("components_cloud_DataConsentDialog.eachMaaBoxUsesAnIndependentKeyAndAes")}</li>
            <li>{intl("components_cloud_DataConsentDialog.theFiveMostRecentSchedulesAreSyncedUpTo")}</li>
            <li>{intl("components_cloud_DataConsentDialog.thirdPartyGameAccountUidsNicknamesBoxDataCredentials")}</li>
          </ul>
          <label className="flex min-h-11 items-start gap-3" htmlFor={`${id}-terms`}>
            <input id={`${id}-terms`} type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />
            <span>{intl.rich("components_cloud_DataConsentDialog.rich1", { element1: (chunks) => (<Link to="/terms" target="_blank" className="mx-1 text-foreground underline underline-offset-4">{chunks}</Link>) })}</span>
          </label>
          <label className="flex min-h-11 items-start gap-3" htmlFor={`${id}-privacy`}>
            <input id={`${id}-privacy`} type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />
            <span>{intl.rich("components_cloud_DataConsentDialog.rich2", { element1: (chunks) => (<Link to="/privacy" target="_blank" className="mx-1 text-foreground underline underline-offset-4">{chunks}</Link>) })}</span>
          </label>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </DialogBody>
        <DialogFooter className="flex-col items-stretch border-t border-border/50 sm:flex-row sm:items-center">
          <Button className="w-full sm:w-auto" type="button" size="dialog" variant="outline" disabled={saving} onClick={onDecline}>{intl("components_cloud_DataConsentDialog.keepLocalOnlyMode")}</Button>
          <Button className="w-full sm:w-auto" type="button" size="dialog" disabled={saving || (!reloadRequired && (!terms || !privacy))} onClick={onAccept}>{saving ? intl("components_cloud_DataConsentDialog.enabling") : reloadRequired ? intl("components_cloud_DataConsentDialog.reloadUpdatedPolicy") : intl("components_cloud_DataConsentDialog.agreeAndStartSyncing")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
