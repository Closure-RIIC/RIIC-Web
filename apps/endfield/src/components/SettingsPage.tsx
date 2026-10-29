import { APP_LOCALES, LOCALE_LABELS } from "@riic/contracts/locale";
import { useLanguage } from "@riic/shell/LanguageProvider";
import { useState } from "react";
import { Download, Eye, EyeOff, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Action, Notice, PageTitle, Section } from "@riic/endfield-ui";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { reportAccountActivity } from "@riic/shell/account-activity";
import { FilterSelect } from "@riic/ui-primitives/filter-select";
import { FluidOrb } from "@riic/ui-primitives/fluid-orb";
import { accountOrbColor } from "@riic/shell/account-orb";
import { DEFAULT_OPTIONS, STORAGE_KEY } from "@riic/endfield-solver/model.mjs";
import { useWorkspace, downloadJson } from "../state";
import { useAccount, type AccountAction } from "../account";
import { ConfirmAction } from "./ConfirmAction";

export function SettingsPage() {
  const language = useLanguage();
  const { workspace, update, busy: solving, ready, t, locale, setLocale, colorMode, setColorMode, showImages, setShowImages, showDijiangBackdrop, setShowDijiangBackdrop, storageError, repairStorage, clearLocalData } = useWorkspace();
  const { session, pending, failed, busy, run, refresh } = useAccount();
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [deleteLocal, setDeleteLocal] = useState(true);
  const [error, setError] = useState<"password" | "session" | "account" | "clear" | "read" | "">("");
  const errorText = {
    password: t("Settings.theCurrentPasswordIsIncorrect"),
    session: t("Settings.yourSessionExpiredSignInAndRetry"),
    account: t("Settings.accountOperationFailedPleaseTryAgain"),
    clear: t("Settings.couldNotClearData"),
    read: t("Settings.couldNotReadTheSavedCopy"),
  };
  const [clearing, setClearing] = useState(false);
  const expiryDate = session ? new Date(session.session.expiresAt) : null;
  const expiry = expiryDate && Number.isFinite(expiryDate.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(expiryDate) : "—";
  const disabled = busy !== null || pending || clearing;
  async function manage(action: AccountAction) {
    setError("");
    try {
      await run(action, action === "delete" ? password : undefined);
      reportAccountActivity({
        title: t("Settings.signInAndSecurity"),
        description: action === "extend" ? t("Settings.sessionExtendedFor30Days") : action === "revoke" ? t("Settings.signedOutOnAllDevices") : t("Settings.accountDeleted"),
      });
      if (action === "delete" && deleteLocal) await clearLocalData();
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "INVALID_PASSWORD" ? "password"
        : cause instanceof Error && cause.message === "SIGNED_OUT" ? "session" : "account");
    } finally { if (action === "delete") setPassword(""); }
  }
  async function clearData() {
    setClearing(true); setError("");
    try { await clearLocalData(); }
    catch { setError("clear"); setClearing(false); }
  }
  return <div className="ef-page" data-endfield-settings>
    <PageTitle title={t("Settings.settings")} subtitle={t("Settings.manageYourAccountSiteAppearanceAndLocalEndfieldData")}
      action={session ? <div className="ef-settings-identity" data-settings-identity>
        <FluidOrb size={32} color={accountOrbColor(session.user.id)} animation="hover" />
        <div><strong title={session.user.name}>{session.user.name}</strong><span title={session.user.email}>{session.user.email}</span></div>
      </div> : undefined} />
    {error ? <Notice error>{errorText[error]}</Notice> : null}
    <div className="ef-settings-grid">
      <div>
        <Section title={t("Settings.appearance")}><div data-settings-group="display" className="ef-settings-fields">
          <div className="ef-settings-row"><div><label htmlFor="ef-color-mode">{t("Settings.appearanceMode")}</label><p>{t("Settings.appliesToEndfieldOnlyArknightsKeepsItsOwnTheme")}</p></div>
            <FilterSelect id="ef-color-mode" aria-label={t("Settings.appearanceMode")} value={colorMode} onValueChange={value => { if (value === "light" || value === "dark") setColorMode(value); }} options={[{ value: "light", label: t("Settings.dayMode") }, { value: "dark", label: t("Settings.nightMode") }]} /></div>
          <div className="ef-settings-row"><div><span>{t("Settings.language")}</span><p>{t("Settings.chooseTheDisplayLanguageForEndfield")}</p></div>
            <div className="ef-language" aria-label={t("Settings.language")} aria-busy={language.pending}>{APP_LOCALES.map(value => <button key={value} type="button" disabled={language.pending} aria-pressed={locale === value} onClick={() => void setLocale(value)}>{LOCALE_LABELS[value]}</button>)}</div></div>
          {language.error ? <Notice error>{t("AccountMenu.languageFailed")}</Notice> : null}
          <label className="ef-settings-row" htmlFor="ef-load-images"><div><span>{t("Settings.loadOperatorAndWeaponImages")}</span><p>{t("Settings.useTextPlaceholdersAndSkipSkillIconsWhenDisabled")}</p></div><input id="ef-load-images" type="checkbox" checked={showImages} onChange={e => setShowImages(e.target.checked)} /></label>
          <label className="ef-settings-row" htmlFor="ef-show-dijiang"><div><span>{t("Settings.showDijiangBackdrop")}</span><p>{t("Settings.showTheAnimatedDijiangBehindSchedulingResults")}</p></div><input id="ef-show-dijiang" type="checkbox" checked={showDijiangBackdrop} disabled={!ready} onChange={e => setShowDijiangBackdrop(e.target.checked)} /></label>
        </div></Section>
        <Section title={t("Settings.schedulingSearch")}><div data-settings-group="solver" className="ef-settings-fields">
          <p className="ef-settings-description">{t("Settings.defaultsTo5SecondsAnd200000NodesIncrease")}</p>
          <div className="ef-settings-row"><label htmlFor="ef-search-time">{t("Settings.timeLimit")}</label>
            <FilterSelect id="ef-search-time" disabled={!ready || solving || clearing} value={workspace.options.time}
              onValueChange={value => update({ ...workspace, options: { ...workspace.options, time: Number(value) } })}
              options={[...new Set([5000,15000,30000,workspace.options.time])].sort((a,b) => a-b).map(value => ({ value, label: `${value / 1000}s` }))} /></div>
          <div className="ef-settings-row"><label htmlFor="ef-search-nodes">{t("Settings.nodeLimit")}</label>
            <FilterSelect id="ef-search-nodes" disabled={!ready || solving || clearing} value={workspace.options.budget}
              onValueChange={value => update({ ...workspace, options: { ...workspace.options, budget: Number(value) } })}
              options={[...new Set([200000,500000,2000000,workspace.options.budget])].sort((a,b) => a-b).map(value => ({ value, label: value.toLocaleString(locale) }))} /></div>
          <div><Action size="sm" disabled={!ready || solving || clearing || (workspace.options.time === DEFAULT_OPTIONS.time && workspace.options.budget === DEFAULT_OPTIONS.budget)}
            onClick={() => update({ ...workspace, options: { ...workspace.options, time: DEFAULT_OPTIONS.time, budget: DEFAULT_OPTIONS.budget } })}>{t("Settings.resetSearchBudget")}</Action></div>
        </div></Section>
        <Section title={t("Settings.localData")}><div data-settings-group="local-data">
          <p className="ef-settings-description">{t("Settings.yourRosterFacilitiesManualScheduleAndLatestResultAre")}</p>
          <div className="ef-actions"><Action size="sm" icon={<Download />} disabled={!ready || clearing} onClick={() => downloadJson("endfield-workspace.json", workspace)}>{t("Settings.exportCurrentSetup")}</Action>
            {storageError ? <><Action size="sm" onClick={() => { try { downloadJson("endfield-storage-backup.json", { raw: localStorage.getItem(STORAGE_KEY) }); } catch { setError("read"); } }}>{t("Settings.exportSavedCopy")}</Action>
              <ConfirmAction variant="red" title={t("Settings.repairLocalArchive")}
                description={t("Settings.replaceTheUnreadableSavedCopyWithYourCurrentSetup")}
                confirmLabel={t("Settings.confirmRepair")} onConfirm={repairStorage}>{t("Settings.repairLocalArchive")}</ConfirmAction></> : null}
          </div>
          {storageError ? <Notice error>{storageError}</Notice> : null}
          <div className="ef-settings-subsection"><h3>{t("Settings.clearLocalCache")}</h3><p className="ef-settings-description">{t("Settings.removeEndfieldSLocalDataAndAppearancePreferencesWhile")}</p>
            <ConfirmAction variant="red" icon={<Trash2 />} disabled={!ready || disabled} title={t("Settings.clearLocalData")}
              description={t("Settings.clearEndfieldSLocalRosterFacilitiesManualScheduleResult")}
              confirmLabel={t("Settings.confirmClear")} onConfirm={() => void clearData()}>{clearing ? t("Settings.clearing") : t("Settings.clearData")}</ConfirmAction>
          </div>
        </div></Section>
      </div>
      <div>
        <Section title={t("Settings.signInAndSecurity")}><div data-settings-group="security">
          {pending ? <p role="status" className="ef-settings-description">{t("Settings.loadingAccount")}</p> : session ? <>
            <div className="ef-settings-session"><ShieldCheck size={20} aria-hidden /><div><strong>{t("Settings.signedInToRiic")}</strong><p>{t("Settings.sessionExpires")}{expiry}</p></div></div>
            <p className="ef-settings-description">{t("Settings.yourAccountIsSharedWithArknightsExtendThisSession")}</p>
            <div className="ef-actions"><Action size="sm" variant="dark" icon={<RefreshCw />} disabled={disabled} onClick={() => void manage("extend")}>{busy === "extend" ? t("Settings.extending") : t("Settings.extend30Days")}</Action>
              <ConfirmAction disabled={disabled} title={t("Settings.signOutEverywhere")}
                description={t("Settings.signOutOnAllDevicesBothSitesWillRequire")}
                confirmLabel={t("Settings.confirmSignOut")} onConfirm={() => void manage("revoke")}>{t("Settings.signOutEverywhere")}</ConfirmAction>
            </div>
          </> : <>
            <p className="ef-settings-description">{failed ? t("Settings.accountServiceUnavailablePleaseRetry") : t("Settings.useTheSameRiicAccountForBothGames")}</p>
            <div className="ef-actions"><Action size="sm" variant="dark" onClick={event => requestAccountSignIn(event.currentTarget)}>{t("Settings.signInRegister")}</Action><Action size="sm" disabled={disabled} onClick={() => void refresh()}>{t("Settings.refreshSignInStatus")}</Action></div>
          </>}
        </div></Section>
        {session ? <Section title={t("Settings.deleteAccount")}><div data-settings-group="delete-account">
          <p className="ef-settings-description">{t("Settings.permanentlyDeleteYourSharedRiicAccountAndItsCloud")}</p>
          <label htmlFor="ef-delete-password" className="ef-settings-label">{t("Settings.currentPassword")}</label>
          <div className="ef-settings-password"><input id="ef-delete-password" type={revealPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" minLength={8} maxLength={128} disabled={disabled} />
            <button type="button" aria-label={revealPassword ? t("Settings.hidePassword") : t("Settings.showPassword")} onClick={() => setRevealPassword(value => !value)}>{revealPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
          <label className="ef-consent"><input type="checkbox" checked={deleteLocal} onChange={e => setDeleteLocal(e.target.checked)} disabled={disabled} /><span>{t("Settings.alsoClearEndfieldDataFromThisBrowser")}</span></label>
          <ConfirmAction variant="red" icon={<Trash2 />} disabled={disabled || password.length < 8} title={t("Settings.permanentlyDeleteAccount")}
            description={t("Settings.thisAccountIsSharedByArknightsAndEndfieldPermanently")}
            confirmLabel={t("Settings.confirmDeletion")} onConfirm={() => void manage("delete")}>{busy === "delete" ? t("Settings.deleting") : t("Settings.permanentlyDeleteAccount")}</ConfirmAction>
        </div></Section> : null}
      </div>
    </div>
  </div>;
}
