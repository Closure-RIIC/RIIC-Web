import { useEffect, useRef, useState } from "react";
import { Action, Notice } from "@riic/endfield-ui";
import type { EndfieldSnapshot } from "@riic/endfield-skland/model";
import { useWorkspace } from "../state";
import { sklandApi } from "../skland-client";
import { syncSklandWorkspace } from "../skland-workspace";
import { operatorCatalog } from "@riic/endfield-data";

export function RestoreAccountButton() {
  const { workspace, update, ready, busy, setSklandSnapshot, reportSklandSync, t } = useWorkspace();
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState("");
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
      if (!Array.isArray(identity) || identity.length !== 4 || identity.some(value => typeof value !== "string" || !value)) throw new Error(t("请先通过森空岛同步账号。", "Sync an account from Skland first."));
      const [ownerKey, accountId, serverId, roleId] = identity as string[];
      const accounts = await sklandApi<{ ownerKey: string; accounts: { id: string }[] }>("accounts", controller.signal);
      if (accounts.ownerKey !== ownerKey || !accounts.accounts.some(account => account.id === accountId)) throw new Error(t("原账号授权已失效，请到森空岛同步页重新授权。", "The original account authorization expired. Reauthorize on the Skland page."));
      const { snapshot } = await sklandApi<{ snapshot: EndfieldSnapshot }>("sync", controller.signal, { accountId, serverId, roleId, force: true });
      if (snapshot.rosterComplete === false || !snapshot.characters.length) throw new Error(t("森空岛未返回完整干员名单，无法准确恢复拥有状态。已保留本地配置，请公开完整干员数据后重试。", "Skland did not return the full roster, so ownership cannot be restored accurately. Local settings were kept. Make your full roster public and retry."));
      controller.signal.throwIfAborted();
      let facilitiesApplied = false;
      update(current => {
        if (current.rosterSource !== workspace.rosterSource) throw new Error(t("账号已切换，请重新操作。", "The account changed. Retry."));
        const restored = syncSklandWorkspace(current, snapshot, workspace.rosterSource!, roleId, operatorCatalog);
        if (restored.status.blocked) throw new Error(t("账号数据无法恢复，已保留本地配置。", "Account data cannot be restored. Local settings were kept."));
        facilitiesApplied = restored.status.facilitiesApplied;
        const next = { ...restored.workspace };
        delete next.manual;
        reportSklandSync(restored.status);
        return next;
      });
      setSklandSnapshot(snapshot);
      setMessage(facilitiesApplied
        ? t("已恢复账号实际干员练度、技能与设施等级。", "Restored your actual operators, skills and facility levels.")
        : t("已恢复账号实际干员练度与技能。森空岛设施数据不完整，保留当前设施等级，可在上方手动调整。", "Restored your actual operators and skills. Skland facility data is incomplete; existing levels were kept and can be adjusted above."));
    } catch (error) {
      if (!controller.signal.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : t("恢复失败，请重试。", "Restore failed. Retry.")); }
    } finally {
      if (request.current === controller) { request.current = null; setRestoring(false); }
    }
  }
  return <div className="mt-3">
    <Action size="sm" disabled={!ready || busy || restoring || !workspace.rosterSource} onClick={() => void restore()}>{restoring ? t("正在恢复…", "Restoring…") : t("恢复账号实际配置", "Restore actual account")}</Action>
    <p className="ef-settings-description">{t("从森空岛恢复实际干员练度与技能，清除手动排班草稿。设施数据完整时恢复等级，否则保留当前等级；生产偏好保留。", "Restore actual operators and skills from Skland and clear manual drafts. Restore facility levels when complete; otherwise keep current levels. Production preferences are kept.")}</p>
    {message ? <Notice error={failed}>{message}</Notice> : null}
  </div>;
}
