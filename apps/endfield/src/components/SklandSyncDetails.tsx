import { type ReactNode, useId } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, Check, CheckCheck, FileDiff, Info, ShieldCheck, UserPlus, Building2, TrendingUp, TriangleAlert, ChevronDown } from "lucide-react";
import { ActionContent, actionClassName, Notice } from "@riic/endfield-ui";
import { skillTiersOf, operatorData } from "@riic/endfield-data";
import { unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";
import type { Operator } from "@riic/endfield-solver/model.mjs";
import { SYNC_FACILITY_KEYS, type SyncFacilityKey } from "../skland-sync-report";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { OperatorPortrait } from "./GameArtwork";
import styles from "./SklandSyncDetails.module.css";

function ChangeSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return <details className={styles.section} open>
    <summary><h3 id={id}>{title}<span>{count}</span></h3><ChevronDown size={16} aria-hidden /></summary>
    <div className={styles.rows}>{children}</div>
  </details>;
}
function OperatorRow({ name, children, aside }: { name: string; children?: ReactNode; aside: ReactNode }) {
  const { locale } = useWorkspace();
  return <div className={styles.row}>
    <OperatorPortrait name={name} elite={null} size={40} />
    <div className={styles.rowCopy}><strong>{locale === "en" ? operatorData(name)?.enName || name : name}</strong>{children}</div>
    <div className={styles.aside}>{aside}</div>
  </div>;
}
function Difference({ before, after }: { before: string; after: string }) {
  const { t } = useWorkspace();
  return <span className={styles.change}><span>{before}</span><ArrowRight size={14} aria-label={t("变更为", "changed to")} /><strong>{after}</strong></span>;
}
function SkillChanges({ before, after }: { before?: Operator; after: Operator }) {
  const { locale, t } = useWorkspace();
  const tiers = skillTiersOf(after.name);
  const previous = before ? unlockedSkillNodes(tiers, before) : [];
  const current = unlockedSkillNodes(tiers, after);
  const added = current.filter(id => !previous.includes(id));
  const removed = previous.filter(id => !current.includes(id));
  const label = (id: string) => {
    const tier = tiers.find(entry => entry.nodeId === id);
    return tier ? `${locale === "en" ? tier.enName || tier.name : tier.name} Lv.${tier.level}` : id;
  };
  return <div className={styles.skills}>
    <p>{t("实际解锁技能", "Unlocked ship skills")} <b>{before ? `${previous.length}/${tiers.length} → ` : ""}{current.length}/{tiers.length}</b></p>
    {before && before.latestSpaceshipSkillNodes === undefined ? <p>{t("同步前按精英化估算；现已按账号实际节点核对。", "Previously estimated from elite stage; now verified against actual account nodes.")}</p> : null}
    {added.length ? <div className={styles.skillAdded}><span>{t("解锁", "Unlocked")}</span>{added.map(id => <span className={styles.skillTag} key={id}>{label(id)}</span>)}</div> : null}
    {removed.length ? <p className={styles.skillRemoved}>{t("核对后未解锁", "Not unlocked after verification")}：{removed.map(label).join("、")}</p> : null}
  </div>;
}

export function SklandSyncDetails() {
  const { sklandSyncReport: report, sklandSyncDetailsOpen: open, setSklandSyncDetailsOpen: setOpen, setSklandSyncActivity, storageError, locale, t } = useWorkspace();
  if (!report) return null;
  const roomName = (key: SyncFacilityKey) => ({
    center: t("总控中枢", "Control center"), mfg1: t("制造舱 Ⅰ", "Manufacturing I"), mfg2: t("制造舱 Ⅱ", "Manufacturing II"),
    grow: t("培养舱", "Growth chamber"), guest: t("会客室", "Reception"),
  })[key];
  const level = (value: number) => value ? `Lv.${value}` : t("未建造", "Not built");
  const skipped = report.unsupported.length;
  const stats = [
    { label: t("新增干员", "New operators"), count: report.added.length, icon: UserPlus },
    { label: t("练度更新", "Progression changes"), count: report.updated.length, icon: TrendingUp },
    { label: t("设施更新", "Facility changes"), count: report.facilities.length, icon: Building2 },
    { label: t("未导入", "Excluded"), count: skipped, icon: Info },
  ];
  return <Dialog.Root open={open} onOpenChange={next => { setOpen(next); if (!next) setSklandSyncActivity(null); }}>
    <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className={styles.dialog} title={t("森空岛同步明细", "Skland sync details")}
        closeLabel={t("关闭同步明细", "Close sync details")}
        description={t("本次同步前后的配置变化，按干员与设施分类展示。", "Changes to your local settings, grouped by operators and facilities.")}
        footer={<>
          <span className={styles.safe}><ShieldCheck size={15} />{storageError ? t("本地保存异常，请保留当前页面", "Local save failed. Keep this page open.") : t("配置自动保存在当前浏览器", "Settings save automatically in this browser")}</span>
          <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent icon={<Check />}>{t("知道了", "Got it")}</ActionContent></Dialog.Close>
        </>}>
        <div className={styles.summary}>
          <div className={`${styles.statusIcon} ${report.blocked ? styles.warning : ""}`}>{report.blocked ? <TriangleAlert size={23} /> : report.noChanges ? <CheckCheck size={23} /> : <Check size={23} />}</div>
          <div className={styles.headline}>
            <span className={styles.eyebrow}>{t("森空岛 · 本次同步", "SKLAND · SYNC REPORT")}</span>
            <h2>{report.blocked ? t("本次数据未覆盖配置", "Local settings were preserved") : report.noChanges ? t("同步完成", "Sync complete") : t("同步完成，配置已更新", "Sync complete. Settings updated.")}</h2>
            <p>{t(`可排班干员 ${report.beforeCount} → ${report.afterCount} 名`, `Scheduling roster ${report.beforeCount} → ${report.afterCount}`)}</p>
          </div>
          <time className={styles.time} dateTime={new Date(report.at).toISOString()}>{new Date(report.at).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </div>
        {report.accountChanged ? <Notice>{t("本次切换了账号或角色，变化是与切换前的本地配置比较，不代表原账号丢失干员。", "Account or character changed. Differences reflect the previous local setup, not operators lost from the previous account.")}</Notice> : null}
        {report.blocked ? <Notice error>{report.blocked === "partial" ? t("新账号返回的名单不完整，原名单和设施均已保留。请公开完整角色数据后重试。", "The new account returned an incomplete roster. Existing operators and facilities were preserved. Make character data public and retry.") : t("返回干员尚未被当前版本识别，原配置已保留。", "The returned operators are not supported by this version. Local settings were preserved.")}</Notice> : null}
        {!report.facilitiesApplied && !report.blocked ? <Notice>{t("设施数据不完整或不符合当前排班规则，保留了本地设施等级。", "Facility data is incomplete or invalid for scheduling. Local facility levels were preserved.")}</Notice> : null}
        {report.partial && !report.blocked ? <Notice>{t("本次名单不完整，仅更新已返回的干员，未返回的原有干员仍保留。", "This roster is partial. Returned operators were updated; other existing operators were retained.")}</Notice> : null}
        {storageError ? <Notice error>{storageError}</Notice> : null}
        <dl className={`${styles.stats} ${report.noChanges ? styles.quietStats : ""}`}>{stats.map(({ label, count, icon: Icon }) => <div key={label} data-active={count > 0 || undefined}>
          <dt><Icon size={15} />{label}</dt><dd>{count}<span>{t("项", "items")}</span></dd>
        </div>)}</dl>
        {report.noChanges ? <div className={styles.empty}><CheckCheck size={24} /><div><strong>{t("本次没有配置变化", "No settings changed")}</strong><p>{t("名单、精英阶段与技能节点未变化；设施是否已核对见上方提示。", "Roster, elite stages and skill nodes are unchanged. See the notice above for facility verification.")}</p></div></div> : null}
        {report.added.length ? <ChangeSection key={`${report.at}:added`} title={t("新增干员", "New operators")} count={report.added.length}>
          {report.added.map(operator => <OperatorRow key={operator.name} name={operator.name} aside={<span className={styles.added}>+ E{operator.elite}</span>}><SkillChanges after={operator} /></OperatorRow>)}
        </ChangeSection> : null}
        {report.updated.length ? <ChangeSection key={`${report.at}:updated`} title={t("练度与技能变化", "Progression & skills")} count={report.updated.length}>
          {report.updated.map(row => <OperatorRow key={row.name} name={row.name} aside={row.before.elite === row.after.elite ? <span className={styles.retained}>E{row.after.elite}</span> : <Difference before={`E${row.before.elite}`} after={`E${row.after.elite}`} />}>
            <SkillChanges before={row.before} after={row.after} />
          </OperatorRow>)}
        </ChangeSection> : null}
        {report.facilities.length ? <ChangeSection key={`${report.at}:facilities`} title={t("设施等级变化", "Facility levels")} count={report.facilities.length}>
          {report.facilities.map(row => <div className={styles.row} key={row.key}><span className={styles.facilityIcon}><Building2 size={19} /></span>
            <div className={styles.rowCopy}><strong>{roomName(row.key)}</strong><p>{t("已用于后续排班计算", "Applied to subsequent scheduling")}</p></div><Difference before={level(row.before)} after={level(row.after)} />
          </div>)}
        </ChangeSection> : null}
        {report.removed.length ? <ChangeSection key={`${report.at}:removed`} title={t("移出当前排班名单", "Removed from the current roster")} count={report.removed.length}>
          {report.removed.map(operator => <OperatorRow key={operator.name} name={operator.name} aside={<span className={styles.skipped}>{t("已移出", "Removed")}</span>}><p>{t("本次完整名单中未包含该干员。", "Not present in the complete roster applied by this sync.")}</p></OperatorRow>)}
        </ChangeSection> : null}
        {skipped ? <ChangeSection key={`${report.at}:skipped`} title={t("未导入及原因", "Excluded & why")} count={skipped}>
          {report.unsupported.map((name, index) => <OperatorRow key={`${name}-${index}`} name={name} aside={<span className={styles.skipped}>{t("暂未支持", "Unsupported")}</span>}><p>{t("未匹配到当前干员目录，未猜测或添加其技能。", "Not found in this version's operator catalogue. No skills were inferred.")}</p></OperatorRow>)}
        </ChangeSection> : null}
        {report.facilitiesApplied ? <div className={styles.levels} aria-label={t("同步后设施等级", "Facility levels after sync")}>
          <h3><Building2 size={15} />{t("同步后设施", "Facilities after sync")}</h3>
          <dl>{SYNC_FACILITY_KEYS.map(key => <div key={key}><dt>{roomName(key)}</dt><dd>{level(report.levels[key])}</dd></div>)}</dl>
        </div> : null}
        {!report.blocked ? <p className={styles.unchanged}><FileDiff size={14} />{t(`另有 ${report.unchangedOperators} 名干员未变更${report.facilitiesApplied ? `，${report.unchangedFacilities} 个设施等级未变化` : ""}。`, `${report.unchangedOperators} operators unchanged${report.facilitiesApplied ? `; ${report.unchangedFacilities} facility levels unchanged` : ""}.`)}</p> : null}
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
