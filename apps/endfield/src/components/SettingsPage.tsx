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
  const { workspace, update, busy: solving, ready, t, locale, setLocale, colorMode, setColorMode, showImages, setShowImages, showDijiangBackdrop, setShowDijiangBackdrop, storageError, repairStorage, clearLocalData } = useWorkspace();
  const { session, pending, failed, busy, run, refresh } = useAccount();
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [deleteLocal, setDeleteLocal] = useState(true);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const expiryDate = session ? new Date(session.session.expiresAt) : null;
  const expiry = expiryDate && Number.isFinite(expiryDate.getTime()) ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(expiryDate) : "—";
  const disabled = busy !== null || pending || clearing;
  async function manage(action: AccountAction) {
    setError("");
    try {
      await run(action, action === "delete" ? password : undefined);
      reportAccountActivity({
        title: t("登录与安全", "Sign-in and security"),
        description: action === "extend" ? t("登录有效期已续期 30 天。", "Session extended for 30 days.") : action === "revoke" ? t("已退出所有设备。", "Signed out on all devices.") : t("账号已删除。", "Account deleted."),
      });
      if (action === "delete" && deleteLocal) await clearLocalData();
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "INVALID_PASSWORD" ? t("当前密码不正确。", "The current password is incorrect.")
        : cause instanceof Error && cause.message === "SIGNED_OUT" ? t("登录已过期，请重新登录后重试。", "Your session expired. Sign in and retry.")
          : t("账号操作失败，请稍后重试。", "Account operation failed. Please try again."));
    } finally { if (action === "delete") setPassword(""); }
  }
  async function clearData() {
    setClearing(true); setError("");
    try { await clearLocalData(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("清除失败，请重试。", "Could not clear data.")); setClearing(false); }
  }
  return <div className="ef-page" data-endfield-settings>
    <PageTitle title={t("设置", "Settings")} subtitle={t("管理账号、网站显示与终末地本地数据。", "Manage your account, site appearance and local Endfield data.")}
      action={session ? <div className="ef-settings-identity" data-settings-identity>
        <FluidOrb size={32} color={accountOrbColor(session.user.id)} animation="hover" />
        <div><strong title={session.user.name}>{session.user.name}</strong><span title={session.user.email}>{session.user.email}</span></div>
      </div> : undefined} />
    {error ? <Notice error>{error}</Notice> : null}
    <div className="ef-settings-grid">
      <div>
        <Section title={t("界面与显示", "Appearance")}><div data-settings-group="display" className="ef-settings-fields">
          <div className="ef-settings-row"><div><label htmlFor="ef-color-mode">{t("外观模式", "Appearance mode")}</label><p>{t("仅应用于终末地，不改变明日方舟的主题。", "Applies to Endfield only; Arknights keeps its own theme.")}</p></div>
            <FilterSelect id="ef-color-mode" aria-label={t("外观模式", "Appearance mode")} value={colorMode} onValueChange={value => { if (value === "light" || value === "dark") setColorMode(value); }} options={[{ value: "light", label: t("日间模式", "Day mode") }, { value: "dark", label: t("夜间模式", "Night mode") }]} /></div>
          <div className="ef-settings-row"><div><span>{t("语言", "Language")}</span><p>{t("仅切换终末地的显示语言。", "Choose the display language for Endfield.")}</p></div>
            <div className="ef-language" aria-label={t("语言", "Language")}><button type="button" aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}>中文</button><button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button></div></div>
          <label className="ef-settings-row" htmlFor="ef-load-images"><div><span>{t("加载干员与武器图片", "Load operator and weapon images")}</span><p>{t("关闭后使用文字占位，同时停用技能图标加载。", "Use text placeholders and skip skill icons when disabled.")}</p></div><input id="ef-load-images" type="checkbox" checked={showImages} onChange={e => setShowImages(e.target.checked)} /></label>
          <label className="ef-settings-row" htmlFor="ef-show-dijiang"><div><span>{t("显示帝江号背景", "Show Dijiang backdrop")}</span><p>{t("在排班结果后显示帝江号动画。", "Show the animated Dijiang behind scheduling results.")}</p></div><input id="ef-show-dijiang" type="checkbox" checked={showDijiangBackdrop} disabled={!ready} onChange={e => setShowDijiangBackdrop(e.target.checked)} /></label>
        </div></Section>
        <Section title={t("排班搜索", "Scheduling search")}><div data-settings-group="solver" className="ef-settings-fields">
          <p className="ef-settings-description">{t("默认使用 5 秒、20 万节点。只有需要更深入搜索时才提高预算，耗时也会增加。", "Defaults to 5 seconds and 200,000 nodes. Increase these only for a deeper search; it may take longer.")}</p>
          <div className="ef-settings-row"><label htmlFor="ef-search-time">{t("时间上限", "Time limit")}</label>
            <FilterSelect id="ef-search-time" disabled={!ready || solving || clearing} value={workspace.options.time}
              onValueChange={value => update({ ...workspace, options: { ...workspace.options, time: Number(value) } })}
              options={[...new Set([5000,15000,30000,workspace.options.time])].sort((a,b) => a-b).map(value => ({ value, label: `${value / 1000}s` }))} /></div>
          <div className="ef-settings-row"><label htmlFor="ef-search-nodes">{t("节点上限", "Node limit")}</label>
            <FilterSelect id="ef-search-nodes" disabled={!ready || solving || clearing} value={workspace.options.budget}
              onValueChange={value => update({ ...workspace, options: { ...workspace.options, budget: Number(value) } })}
              options={[...new Set([200000,500000,2000000,workspace.options.budget])].sort((a,b) => a-b).map(value => ({ value, label: value.toLocaleString(locale === "en" ? "en-US" : "zh-CN") }))} /></div>
          <div><Action size="sm" disabled={!ready || solving || clearing || (workspace.options.time === DEFAULT_OPTIONS.time && workspace.options.budget === DEFAULT_OPTIONS.budget)}
            onClick={() => update({ ...workspace, options: { ...workspace.options, time: DEFAULT_OPTIONS.time, budget: DEFAULT_OPTIONS.budget } })}>{t("恢复默认预算", "Reset search budget")}</Action></div>
        </div></Section>
        <Section title={t("本地数据", "Local data")}><div data-settings-group="local-data">
          <p className="ef-settings-description">{t("名单、设施、手动排班和最近一次求解结果保存在当前浏览器，独立于明日方舟数据。", "Your roster, facilities, manual schedule and latest result are stored in this browser, separately from Arknights.")}</p>
          <div className="ef-actions"><Action size="sm" icon={<Download />} disabled={!ready || clearing} onClick={() => downloadJson("endfield-workspace.json", workspace)}>{t("导出当前配置", "Export current setup")}</Action>
            {storageError ? <><Action size="sm" onClick={() => { try { downloadJson("endfield-storage-backup.json", { raw: localStorage.getItem(STORAGE_KEY) }); } catch { setError(t("无法读取原始存档。", "Could not read the saved copy.")); } }}>{t("导出原始存档", "Export saved copy")}</Action>
              <ConfirmAction variant="red" title={t("修复本地存档", "Repair local archive")}
                description={t("用当前配置覆盖无法读取的存档？请先导出原始存档。", "Replace the unreadable saved copy with your current setup? Export the saved copy first.")}
                confirmLabel={t("确认修复", "Confirm repair")} onConfirm={repairStorage}>{t("修复本地存档", "Repair local archive")}</ConfirmAction></> : null}
          </div>
          {storageError ? <Notice error>{storageError}</Notice> : null}
          <div className="ef-settings-subsection"><h3>{t("清除本地缓存", "Clear local cache")}</h3><p className="ef-settings-description">{t("清除终末地本地数据和显示偏好，保留网站账号及明日方舟数据。建议先导出配置。", "Remove Endfield's local data and appearance preferences while keeping your account and Arknights data. Export your setup first.")}</p>
            <ConfirmAction variant="red" icon={<Trash2 />} disabled={!ready || disabled} title={t("清除本地数据", "Clear local data")}
              description={t("清除终末地的本地名单、设施配置、手动排班、求解结果、显示偏好和缓存？不会影响网站账号或明日方舟数据。", "Clear Endfield's local roster, facilities, manual schedule, result, appearance preferences and cache? Your account and Arknights data will be kept.")}
              confirmLabel={t("确认清除", "Confirm clear")} onConfirm={() => void clearData()}>{clearing ? t("正在清除", "Clearing") : t("清除数据", "Clear data")}</ConfirmAction>
          </div>
        </div></Section>
      </div>
      <div>
        <Section title={t("登录与安全", "Sign-in and security")}><div data-settings-group="security">
          {pending ? <p role="status" className="ef-settings-description">{t("正在读取账号…", "Loading account…")}</p> : session ? <>
            <div className="ef-settings-session"><ShieldCheck size={20} aria-hidden /><div><strong>{t("已登录 RIIC 账号", "Signed in to RIIC")}</strong><p>{t("登录到期时间：", "Session expires: ")}{expiry}</p></div></div>
            <p className="ef-settings-description">{t("账号与明日方舟共用。可延长本次登录，或撤销全部设备的登录会话。", "Your account is shared with Arknights. Extend this session or revoke all signed-in sessions.")}</p>
            <div className="ef-actions"><Action size="sm" variant="dark" icon={<RefreshCw />} disabled={disabled} onClick={() => void manage("extend")}>{busy === "extend" ? t("正在续期", "Extending") : t("续期 30 天", "Extend 30 days")}</Action>
              <ConfirmAction disabled={disabled} title={t("退出所有设备", "Sign out everywhere")}
                description={t("将退出所有设备，两站都需要重新登录，是否继续？", "Sign out on all devices? Both sites will require sign-in again.")}
                confirmLabel={t("确认退出", "Confirm sign-out")} onConfirm={() => void manage("revoke")}>{t("退出所有设备", "Sign out everywhere")}</ConfirmAction>
            </div>
          </> : <>
            <p className="ef-settings-description">{failed ? t("账号服务暂不可用，请重试。", "Account service unavailable. Please retry.") : t("登录同一个 RIIC 账号，即可在两款游戏中使用账号功能。", "Use the same RIIC account for both games.")}</p>
            <div className="ef-actions"><Action size="sm" variant="dark" onClick={event => requestAccountSignIn(event.currentTarget)}>{t("登录 / 注册", "Sign in / Register")}</Action><Action size="sm" disabled={disabled} onClick={() => void refresh()}>{t("刷新登录状态", "Refresh sign-in status")}</Action></div>
          </>}
        </div></Section>
        {session ? <Section title={t("注销账号", "Delete account")}><div data-settings-group="delete-account">
          <p className="ef-settings-description">{t("永久删除共用的 RIIC 账号及其云端数据，明日方舟和终末地都会退出登录。此操作无法恢复。", "Permanently delete your shared RIIC account and its cloud data. Both games will be signed out. This cannot be undone.")}</p>
          <label htmlFor="ef-delete-password" className="ef-settings-label">{t("当前密码", "Current password")}</label>
          <div className="ef-settings-password"><input id="ef-delete-password" type={revealPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" minLength={8} maxLength={128} disabled={disabled} />
            <button type="button" aria-label={revealPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")} onClick={() => setRevealPassword(value => !value)}>{revealPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
          <label className="ef-consent"><input type="checkbox" checked={deleteLocal} onChange={e => setDeleteLocal(e.target.checked)} disabled={disabled} /><span>{t("同时清除当前浏览器的终末地本地数据", "Also clear Endfield data from this browser")}</span></label>
          <ConfirmAction variant="red" icon={<Trash2 />} disabled={disabled || password.length < 8} title={t("永久注销账号", "Permanently delete account")}
            description={t("此账号由明日方舟与终末地共用。永久删除账号及云端数据后无法恢复，是否继续？", "This account is shared by Arknights and Endfield. Permanently delete it and its cloud data? This cannot be undone.")}
            confirmLabel={t("确认注销", "Confirm deletion")} onConfirm={() => void manage("delete")}>{busy === "delete" ? t("正在注销", "Deleting") : t("永久注销账号", "Permanently delete account")}</ConfirmAction>
        </div></Section> : null}
      </div>
    </div>
  </div>;
}
