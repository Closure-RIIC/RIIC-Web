import { useEffect, useRef, useState } from "react";
import { Action, Notice } from "@riic/endfield-ui";
import type { EndfieldSnapshot } from "@riic/endfield-skland/model";
import { useWorkspace } from "../state";
import { sklandApi } from "../skland-client";
import { SklandFeedbackError, sklandErrorKey, type SklandFeedbackKey } from "../skland-feedback";
import { sklandFeedbackText } from "../skland-feedback-text";
import { buildSklandSyncReport } from "../skland-sync-report";
import { syncSklandWorkspace } from "../skland-workspace";
import { operatorCatalog } from "@riic/endfield-data";

export function RestoreAccountButton() {
  const { workspace, update, ready, busy, setSklandSnapshot, reportSklandSync, t } = useWorkspace();
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<SklandFeedbackKey | "">("");
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!message || failed) return;
    const timer = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [message, failed]);
  async function restore() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setRestoring(true); setMessage(""); setFailed(false);
    try {
      const identity: unknown = JSON.parse(workspace.rosterSource ?? "null");
      if (!Array.isArray(identity) || identity.length !== 4 || identity.some(value => typeof value !== "string" || !value)) throw new SklandFeedbackError("RestoreAccountButton.syncAnAccountFromSklandFirst");
      const [ownerKey, accountId, serverId, roleId] = identity as string[];
      const accounts = await sklandApi<{ ownerKey: string; accounts: { id: string }[] }>("accounts", controller.signal);
      if (accounts.ownerKey !== ownerKey || !accounts.accounts.some(account => account.id === accountId)) throw new SklandFeedbackError("RestoreAccountButton.theOriginalAccountAuthorizationExpiredReauthorizeOnTheSkland");
      const { snapshot } = await sklandApi<{ snapshot: EndfieldSnapshot }>("sync", controller.signal, { accountId, serverId, roleId, force: true });
      if (snapshot.rosterComplete === false || !snapshot.characters.length) throw new SklandFeedbackError("RestoreAccountButton.sklandDidNotReturnTheFullRosterSoOwnership");
      controller.signal.throwIfAborted();
      let facilitiesApplied = false;
      update(current => {
        if (current.rosterSource !== workspace.rosterSource) throw new SklandFeedbackError("RestoreAccountButton.theAccountChangedRetry");
        const restored = syncSklandWorkspace(current, snapshot, workspace.rosterSource!, roleId, operatorCatalog);
        if (restored.status.blocked) throw new SklandFeedbackError("RestoreAccountButton.accountDataCannotBeRestoredLocalSettingsWereKept");
        facilitiesApplied = restored.status.facilitiesApplied;
        const next = { ...restored.workspace };
        delete next.manual;
        reportSklandSync(restored.status, buildSklandSyncReport(current, restored.workspace, restored.status, current.rosterSource ?? ""));
        return next;
      });
      setSklandSnapshot(snapshot);
      setMessage(facilitiesApplied
        ? "RestoreAccountButton.restoredYourActualOperatorsSkillsAndFacilityLevels"
        : "RestoreAccountButton.restoredYourActualOperatorsAndSkillsSklandFacilityData");
    } catch (error) {
      if (!controller.signal.aborted) { setFailed(true); setMessage(sklandErrorKey(error, "RestoreAccountButton.restoreFailedRetry")); }
    } finally {
      if (request.current === controller) { request.current = null; setRestoring(false); }
    }
  }
  return <div className="mt-3">
    <Action size="sm" disabled={!ready || busy || restoring || !workspace.rosterSource} onClick={() => void restore()}>{restoring ? t("RestoreAccountButton.restoring") : t("RestoreAccountButton.restoreActualAccount")}</Action>
    <p className="ef-settings-description">{t("RestoreAccountButton.restoreActualOperatorsAndSkillsFromSklandAndClear")}</p>
    {message ? <Notice error={failed}>{sklandFeedbackText(message, t)}</Notice> : null}
  </div>;
}
