import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { RefreshCw, LogOut, UserPlus } from "lucide-react";
import { Action, ActionContent, actionClassName, Notice } from "@riic/endfield-ui";
import { type EndfieldRole, type EndfieldSnapshot } from "@riic/endfield-skland/model";
import { gameHref } from "@riic/shell/games";
import { FilterSelect } from "@riic/ui-primitives/filter-select";
import { sklandApi as api, SklandRequestError } from "../skland-client";
import { sklandErrorKey, type SklandFeedbackKey } from "../skland-feedback";
import { sklandFeedbackText } from "../skland-feedback-text";
import { SklandLoginPanel, type EndfieldLogin } from "./SklandLoginPanel";
import { SklandDataView, SklandProfile } from "./SklandDataView";
import { useWorkspace, WEBSITE_SIGN_OUT_EVENT, WEBSITE_SESSION_CHANGE_EVENT } from "../state";
import { sklandRosterSource, syncSklandWorkspace } from "../skland-workspace";
import { operatorCatalog } from "@riic/endfield-data";
import { DialogFrame } from "./DialogFrame";
import { CheckCheck, FileDiff, TriangleAlert } from "lucide-react";
import styles from "./SklandPage.module.css";
import { buildSklandSyncReport } from "../skland-sync-report";

type Account = { id: string; label: string; source: string };
type Accounts = { accounts: Account[]; ownerKey: string };
const roleKey = (role: EndfieldRole) => `${role.serverId}:${role.roleId}`;
const selectionKey = "riic:endfield:skland-selection";
function savedSelection(): { accountId?: string; role?: string; ownerKey?: string } {
  try { return JSON.parse(sessionStorage.getItem(selectionKey) ?? "{}") ?? {}; } catch { return {}; }
}

export function SklandPage() {
  const { update, ready, t, setSklandSnapshot, reportSklandSync, setSklandSyncActivity, sklandSyncReport, setSklandSyncReport, setSklandSyncDetailsOpen } = useWorkspace();
  const [origin, setOrigin] = useState<string>();
  const [loginOpen, setLoginOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [roles, setRoles] = useState<EndfieldRole[]>([]);
  const [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<EndfieldSnapshot | null>(null);
  const [pending, setPending] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<SklandFeedbackKey | "">("");
  const controller = useRef<AbortController | null>(null);
  const owner = useRef("");
  const main = gameHref("arknights", origin, import.meta.env.VITE_ARKNIGHTS_ORIGIN);
  const currentAccount = accounts.find(account => account.id === accountId);
  const loadedRole = roles.find(role => roleKey(role) === selected);

  function clearData(resetReport = false) { setSnapshot(null); setSklandSnapshot(null); setSklandSyncActivity(null); if (resetReport) { setSklandSyncReport(null); setSklandSyncDetailsOpen(false); } }
  function cancel() { controller.current?.abort(); controller.current = null; setPending(false); setInitialized(true); }
  async function perform(task: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true); setError("");
    try { await task(request.signal); }
    catch (cause) { if (!request.signal.aborted) setError(sklandErrorKey(cause, "Skland.syncFailedPleaseRetry")); }
    finally { if (controller.current === request) { controller.current = null; setPending(false); setInitialized(true); } }
  }
  async function loadSnapshot(id: string, role: EndfieldRole, signal: AbortSignal, showDetails = true) {
    const value = await api<{ snapshot: EndfieldSnapshot }>("sync", signal, { accountId: id, roleId: role.roleId, serverId: role.serverId });
    if (signal.aborted) return;
    const source = sklandRosterSource(owner.current, id, role);
    update(current => {
      const synced = syncSklandWorkspace(current, value.snapshot, source, role.roleId, operatorCatalog);
      reportSklandSync(synced.status, buildSklandSyncReport(current, synced.workspace, synced.status, source), showDetails);
      // Other scheduling pages must not display equipment from a rejected account.
      setSklandSnapshot(synced.status.blocked ? null : value.snapshot);
      return synced.workspace;
    });
    setSnapshot(value.snapshot);
    try { sessionStorage.setItem(selectionKey, JSON.stringify({ accountId: id, role: roleKey(role), ownerKey: owner.current })); } catch { /* Selection is optional. */ }
  }
  async function installRoles(id: string, next: EndfieldRole[], signal: AbortSignal, preferred?: string, showDetails = true) {
    if (signal.aborted) return;
    setRoles(next);
    const role = next.find(item => roleKey(item) === preferred) ?? next.find(item => item.isDefault) ?? next[0];
    setSelected(role ? roleKey(role) : "");
    if (role) await loadSnapshot(id, role, signal, showDetails);
  }
  function selectAccount(id: string) {
    clearData(true); setRoles([]); setSelected(""); setAccountId(id);
    void perform(async signal => {
      const value = await api<{ roles: EndfieldRole[] }>("roles", signal, { accountId: id });
      await installRoles(id, value.roles, signal);
    });
  }
  async function restoreAccounts(signal: AbortSignal, preserve = false, showDetails = false) {
    let value: Accounts;
    try { value = await api<Accounts>("accounts", signal); }
    catch (cause) {
      if (!signal.aborted && cause instanceof SklandRequestError && [401, 403].includes(cause.status)) {
        clearData(); setAccounts([]); setAccountId(""); setRoles([]);
      }
      throw cause;
    }
    if (signal.aborted) return;
    const sameOwner = owner.current === value.ownerKey;
    owner.current = value.ownerKey;
    setAccounts(value.accounts);
    const saved = savedSelection();
    const preferred = saved.ownerKey === value.ownerKey ? saved.accountId : undefined;
    const next = value.accounts.find(account => account.id === (sameOwner ? accountId : preferred)) ?? value.accounts[0];
    if (!next) { clearData(true); setRoles([]); setAccountId(""); setLoginOpen(true); return; }
    if (preserve && sameOwner && next.id === accountId && snapshot) return;
    clearData(); setRoles([]); setAccountId(next.id); setLoginOpen(false);
    const loaded = await api<{ roles: EndfieldRole[] }>("roles", signal, { accountId: next.id });
    await installRoles(next.id, loaded.roles, signal, saved.accountId === next.id && saved.ownerKey === value.ownerKey ? saved.role : undefined, showDetails);
  }
  function authenticated(value: EndfieldLogin) {
    clearData(true); setLoginOpen(false); setAccountId(value.accountId);
    setAccounts(current => [{ id: value.accountId, label: value.roles[0]?.nickname || "", source: "endfield" }, ...current.filter(account => account.id !== value.accountId)]);
    void perform(async signal => {
      const list = await api<Accounts>("accounts", signal);
      if (signal.aborted) return;
      owner.current = list.ownerKey; setAccounts(list.accounts);
      await installRoles(value.accountId, value.roles, signal);
    });
  }
  const restore = useEffectEvent((preserve: boolean) => {
    if (preserve && (loginOpen || controller.current)) return;
    void perform(signal => restoreAccounts(signal, preserve));
  });
  const signedOut = useEffectEvent(() => {
    cancel();
    clearData(true);
    owner.current = "";
    setAccounts([]); setAccountId(""); setRoles([]); setSelected("");
    setLoginOpen(false); setError(""); setInitialized(true);
    try { sessionStorage.removeItem(selectionKey); } catch { /* Optional selection storage. */ }
  });
  const accountChanged = useEffectEvent(() => {
    cancel(); clearData(true); owner.current = "";
    setAccounts([]); setAccountId(""); setRoles([]); setSelected(""); setLoginOpen(false);
    void perform(signal => restoreAccounts(signal));
  });
  useEffect(() => {
    if (!ready) return;
    setOrigin(location.origin);
    restore(false);
    const onFocus = () => restore(true);
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) restore(false); };
    const onSignOut = () => signedOut();
    const onAccountChange = () => accountChanged();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener(WEBSITE_SIGN_OUT_EVENT, onSignOut);
    window.addEventListener(WEBSITE_SESSION_CHANGE_EVENT, onAccountChange);
    return () => { controller.current?.abort(); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onPageShow); window.removeEventListener(WEBSITE_SIGN_OUT_EVENT, onSignOut); window.removeEventListener(WEBSITE_SESSION_CHANGE_EVENT, onAccountChange); };
  }, [ready]);

  const loginPanel = <SklandLoginPanel main={main} onAuthenticated={authenticated} onMethodChange={() => { setError(""); }} />;
  return <div className={`ef-page${initialized && !accounts.length ? " ef-skland-login" : ""}`} data-endfield-skland aria-busy={pending}>
    <h1 className="sr-only">{t("Skland.sklandSync")}</h1>
    {accounts.length ? <header className={`ef-skland-header ${styles.header}`}>
      <SklandProfile snapshot={snapshot} role={loadedRole} accountLabel={currentAccount?.label} />
      <div className={`ef-skland-controls ${styles.controls}`}>
        <div className="ef-skland-selectors">
          <FilterSelect id="skland-account" aria-label={t("Skland.sklandAccount")} value={accountId} disabled={pending} onValueChange={selectAccount}
            emptyText={t("Skland.noMatchingAccounts")} options={accounts.map((account, index) => ({ value: account.id, label: account.label || `${t("Skland.sklandAccount")} ${index + 1}` }))} />
          {roles.length ? <FilterSelect id="skland-role" aria-label={t("Skland.characterServer")} disabled={pending} value={selected} onValueChange={value => {
            const role = roles.find(item => roleKey(item) === value);
            if (!role) return; clearData(true); setSelected(roleKey(role)); void perform(signal => loadSnapshot(accountId, role, signal));
          }} emptyText={t("Skland.noMatchingCharacters")} options={roles.map(role => ({ value: roleKey(role), label: `${role.nickname} · ${role.serverName}` }))} /> : null}
        </div>
        <div className={`ef-actions ${styles.actions}`}>
          <Action size="sm" variant="yellow" icon={<RefreshCw className={pending ? "ef-spin" : undefined} />}
            aria-label={t("Skland.refreshData")} title={t("Skland.refreshData")}
            disabled={pending} onClick={() => { clearData(); void perform(signal => restoreAccounts(signal, false, true)); }}>{pending ? t("Skland.syncing") : t("Skland.syncData")}</Action>
          <Action size="sm" variant="dark" icon={<UserPlus />} disabled={pending || accounts.filter(account => account.source === "endfield").length >= 5} onClick={() => setLoginOpen(true)}>{t("Skland.addAccount")}</Action>
          <Action size="sm" variant="red" icon={<LogOut />} disabled={pending || currentAccount?.source !== "endfield"}
            title={currentAccount?.source !== "endfield" ? t("Skland.disconnectThisSharedAccountFromArknightsSklandSync") : undefined}
            onClick={() => {
              clearData(true); void perform(async signal => {
                await api("disconnect", signal, { accountId });
                if (!signal.aborted) await restoreAccounts(signal);
              });
            }}>{t("Skland.signOutAccount")}</Action>

        </div>
      </div>
    </header> : null}
    {sklandSyncReport ? <div className={styles.syncBar}>
      <span className={`${styles.syncMark} ${sklandSyncReport.blocked || sklandSyncReport.partial || !sklandSyncReport.facilitiesApplied ? styles.warning : ""}`}>
        {sklandSyncReport.blocked || sklandSyncReport.partial || !sklandSyncReport.facilitiesApplied ? <TriangleAlert size={17} /> : <CheckCheck size={17} />}
      </span>
      <div className={styles.syncCopy}>
        <strong>{sklandSyncReport.blocked ? t("Skland.localSettingsPreserved") : sklandSyncReport.noChanges ? t("Skland.syncedNoSettingsChanged") : t("Skland.syncedSettingsUpdated")}</strong>
        <span>{t("Skland.schedulingOperators", { value1: sklandSyncReport.afterCount })}<i />{new Date(sklandSyncReport.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <Action size="sm" icon={<FileDiff />} disabled={pending} onClick={() => setSklandSyncDetailsOpen(true)}>{t("Skland.latestSyncDetails")}</Action>
    </div> : null}
    {error ? <Notice error>{sklandFeedbackText(error, t)}</Notice> : null}
    {!initialized ? <p className="ef-muted" role="status">{t("Skland.restoringYourSklandAccount")}</p> : null}
    {initialized && !accounts.length ? <div className="ef-login"><header className="ef-login-copy"><h2>{t("Skland.connectToSkland")}</h2><p>{t("Skland.signInToLoadYourCharacterDataConnectedAccounts")}</p></header>{loginPanel}</div> : null}
    {accounts.length ? <>
      {!pending && !roles.length ? <Notice>{t("Skland.thisAccountHasNoAvailableEndfieldCharacterAddAn")}</Notice> : null}
      {!pending && !snapshot && loadedRole ? <Action onClick={() => void perform(signal => loadSnapshot(accountId, loadedRole, signal))}>{t("Skland.retryData")}</Action> : null}
    </> : null}
    {pending && initialized ? <p className="ef-muted" role="status">{t("Skland.readingSklandData")} <Action size="sm" variant="red" onClick={cancel}>{t("Skland.cancel")}</Action></p> : null}
    {snapshot ? <SklandDataView key={`${accountId}:${selected}`} snapshot={snapshot} /> : null}
    <Dialog.Root open={accounts.length > 0 && loginOpen} onOpenChange={setLoginOpen}>
      <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
        <SklandLoginPanel main={main} onAuthenticated={authenticated} onMethodChange={() => { setError(""); }}
          renderDialog={(body, actions) => <DialogFrame title={t("Skland.addSklandAccount")} closeLabel={t("Skland.close")}
            description={t("Skland.saveUpTo5EndfieldAccountsDataLoadsAutomatically")}
            footer={<><Dialog.Close className={actionClassName({ size: "sm" })}><ActionContent>{t("Skland.cancel")}</ActionContent></Dialog.Close>{actions}</>}>
            {body}
          </DialogFrame>} />
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
