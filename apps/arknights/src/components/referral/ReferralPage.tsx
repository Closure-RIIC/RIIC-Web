"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, ChevronDown, Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale } from "use-intl";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { FilterSelect } from "@riic/ui-primitives/filter-select";
import { formatPoints } from "@/billing-points";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { copyText } from "@/download";
import { useWebsiteSession, type WebsiteSessionData } from "@/website-session";
import billing from "@/components/billing/BillingPrototype.module.css";
import styles from "./ReferralPage.module.css";

// Layout fixtures only; these are not account referral records or wallet credits.
const INVITATION_CODE = "RH7K9M2X";
const REWARD = { registration: 100, firstTopup: 200, limit: 3 };
const FRIENDS = [
  { id: "doctor-7k", name: "博士_7K", englishName: "Doctor 7K", date: "2026-10-26", toppedUp: true },
  { id: "doctor-m9", name: "博士_M9", englishName: "Doctor M9", date: "2026-10-24", toppedUp: false },
  { id: "doctor-x2", name: "博士_X2", englishName: "Doctor X2", date: "2026-10-23", toppedUp: false },
];
const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => "";

export function ReferralPage() {
  const english = useLocale() === "en";
  const { data: session, isPending } = useWebsiteSession();
  const features = useFeatureAccess();

  return <section className={`${billing.page} grid min-w-0 w-full content-start gap-4 pt-2 pb-8 md:gap-6 md:pt-5`} data-referral-page>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <WorkbenchPageHeading page="referral" accentColor="var(--billing-highlight)">{english ? "Invite friends" : "邀请返利"}</WorkbenchPageHeading>
        <p className="mt-2 text-sm text-muted-foreground">{english ? "Share the base planner with friends and keep track of your referral rewards." : "邀请好友使用基建终端，查看奖励与邀请进度。"}</p>
      </div>
      {session && features.billing ? <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0" render={<Link to="/billing" />}>{english ? "Payment plans" : "付费计划"}<ArrowUpRight className="size-3.5" /></SetupActionButton> : null}
    </header>
    {isPending ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">{english ? "Loading your account…" : "正在加载账号……"}</p> : session ? <ReferralAccountPreview key={session.user.id} user={session.user} /> : <WorkbenchCard data-referral-sign-in>
      <h2 className="text-sm font-semibold">{english ? "Sign in to view your referrals" : "登录后查看邀请返利"}</h2>
      <p className={`${billing.caption} mt-2`}>{english ? "Use your website account to open this page." : "请先登录网站账号，再查看邀请链接与奖励进度。"}</p>
      <SetupActionButton variant="outline" className="mt-5" onClick={event => requestAccountSignIn(event.currentTarget)}>{english ? "Sign in" : "登录网站账号"}</SetupActionButton>
    </WorkbenchCard>}
  </section>;
}

function ReferralAccountPreview({ user }: { user: WebsiteSessionData["user"] }) {
  const locale = useLocale();
  const english = locale === "en";
  const text = (zh: string, en: string) => english ? en : zh;
  const [scenario, setScenario] = useState("active");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copying = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, serverOrigin);
  const referralLink = `${origin}/referral?ref=${INVITATION_CODE}`;
  const friends = scenario === "empty" ? [] : scenario === "full" ? FRIENDS.map(friend => ({ ...friend, toppedUp: true })) : FRIENDS.slice(0, 2);
  const registered = friends.length;
  const toppedUp = friends.filter(friend => friend.toppedUp).length;
  const earned = registered * REWARD.registration + toppedUp * REWARD.firstTopup;

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(kind: "link" | "code") {
    if (copying.current) return;
    copying.current = true;
    clearTimeout(timer.current);
    setCopied(null);
    setNotice("");
    setError("");
    try {
      await copyText(kind === "link" ? referralLink : INVITATION_CODE);
      setCopied(kind);
      setNotice(kind === "link" ? text("演示邀请链接已复制，可以粘贴分享。", "Demo referral link copied. Ready to share.") : text("演示邀请码已复制。", "Demo referral code copied."));
      timer.current = setTimeout(() => setCopied(null), 2500);
    } catch {
      if (kind === "link") {
        linkInput.current?.focus();
        linkInput.current?.select();
      }
      setError(kind === "code"
        ? text(`复制未成功，请手动复制邀请码：${INVITATION_CODE}`, `Could not copy. Copy this referral code manually: ${INVITATION_CODE}`)
        : text("复制未成功，请长按或选中文本手动复制。", "Could not copy. Select the text and copy it manually."));
    } finally {
      copying.current = false;
    }
  }

  function progress(count: number) {
    return <div className={styles.progress} aria-label={text(`已领取 ${count} / ${REWARD.limit} 次`, `${count} of ${REWARD.limit} rewards claimed`)}>
      <div className={styles.segments} aria-hidden="true">{Array.from({ length: REWARD.limit }, (_, index) => <span key={index} data-filled={index < count || undefined} />)}</div>
      <span className={billing.caption}>{count === REWARD.limit ? text("奖励已领满", "All rewards claimed") : text(`还可领取 ${REWARD.limit - count} 次`, `${REWARD.limit - count} rewards left`)}</span>
    </div>;
  }

  return <div className="contents" data-referral-account={user.id}>
    <WorkbenchCard className={billing.wallet} aria-label={text("邀请概览", "Referral overview")}>
      <div className={billing.available}>
        <h2 className={billing.caption}>{text("累计邀请奖励", "Total referral rewards")}<span className={styles.previewBadge}>{text("演示", "Demo")}</span></h2>
        <p className={`${billing.balance} font-number`}>{formatPoints(earned, locale)}<small>{text("积分", "credits")}</small></p>
        <p className={`${billing.caption} mt-3 break-words`}>{text("当前账号：", "Account: ")}{user.name}</p>
        <p className={`${billing.caption} break-all`}>{user.email}</p>
      </div>
      <dl className={billing.walletDetails}>
        <div><dt className={billing.caption}>{text("已注册好友", "Friends signed up")}</dt><dd className={`${billing.balance} font-number`}>{registered}<small>{text("人", "friends")}</small></dd><dd className={`${billing.caption} mt-2`}>{text("注册奖励已领取", "Sign-up rewards claimed")} {registered} / {REWARD.limit}</dd></div>
        <div><dt className={billing.caption}>{text("已首充好友", "First top-ups")}</dt><dd className={`${billing.balance} font-number`}>{toppedUp}<small>{text("人", "friends")}</small></dd><dd className={`${billing.caption} mt-2`}>{text("首充奖励已领取", "Top-up rewards claimed")} {toppedUp} / {REWARD.limit}</dd></div>
      </dl>
    </WorkbenchCard>

    <WorkbenchCard aria-labelledby="referral-link-heading">
      <div className={billing.sectionHeading}><h2 id="referral-link-heading">{text("邀请好友", "Invite your friends")}</h2><p className={billing.caption}>{text("复制链接，分享给好友", "Copy your link and share it with a friend")}</p></div>
      <div className={styles.invitationRow}>
        <Input ref={linkInput} aria-label={text("演示邀请链接", "Demo referral link")} className={styles.linkInput} value={referralLink} readOnly onFocus={event => event.currentTarget.select()} spellCheck={false} />
        <SetupActionButton className={`${billing.primary} ${styles.copyButton}`} onClick={() => void copy("link")} data-referral-copy>{copied === "link" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied === "link" ? text("链接已复制", "Link copied") : text("复制邀请链接", "Copy referral link")}</SetupActionButton>
        <Dialog>
          <DialogTrigger render={<Button variant="outline" className={billing.pill} aria-label={text("显示邀请二维码", "Show referral QR code")} />}><QrCode aria-hidden="true" />{text("二维码", "QR code")}</DialogTrigger>
          <DialogContent className={styles.qrDialog} closeLabel={text("关闭", "Close")}>
            <DialogHeader><DialogTitle>{text("邀请好友", "Invite a friend")}</DialogTitle><DialogDescription>{text("此二维码用于页面预览，暂不绑定邀请关系或发放积分。", "This preview QR code does not attribute referrals or issue credits.")}</DialogDescription></DialogHeader>
            <DialogBody>
              <div className={styles.qrCode}><QRCodeSVG value={referralLink} size={216} marginSize={2} title={text("演示邀请链接二维码", "Demo referral QR code")} /></div>
              <p className="text-center text-xs text-muted-foreground">{text("演示邀请码：", "Demo referral code: ")}<strong className="font-medium text-foreground">{INVITATION_CODE}</strong></p>
              {notice ? <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
              {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            </DialogBody>
            <DialogFooter><SetupActionButton variant="outline" className="w-full" onClick={() => void copy("link")}>{copied === "link" ? <Check /> : <Copy />}{copied === "link" ? text("链接已复制", "Link copied") : text("复制邀请链接", "Copy referral link")}</SetupActionButton></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className={styles.codeRow}>
        <p className={billing.caption}>{text("演示邀请码", "Demo referral code")}<span className={styles.code}>{INVITATION_CODE}</span></p>
        <Button variant="ghost" size="sm" className={styles.copyCode} aria-label={text(`复制邀请码 ${INVITATION_CODE}`, `Copy referral code ${INVITATION_CODE}`)} onClick={() => void copy("code")}>{copied === "code" ? <Check /> : <Copy />}{text("复制邀请码", "Copy code")}</Button>
      </div>
      {notice ? <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-destructive">{error}</p> : null}
    </WorkbenchCard>

    <div className={billing.activity} aria-label={text("邀请奖励", "Referral rewards")}>
      <WorkbenchCard className={`${billing.product} ${billing.testPack}`} glass>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{text("好友注册", "A friend signs up")}</h2><span className={`${billing.productBadge} rounded-full px-2.5 py-1 text-[10px] font-medium`}>{text("你和好友都能得", "A reward for both of you")}</span></div>
          <p className={`${billing.price} font-number`}>+{formatPoints(REWARD.registration, locale)}<span className="ml-2 text-xs font-normal text-muted-foreground">{text("积分 / 人", "credits each")}</span></p>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">{text("好友通过链接注册并验证邮箱后，你和好友各得一份注册奖励。", "When a friend signs up through your link and verifies their email, you both receive a welcome reward.")}</p>
        {progress(registered)}
      </WorkbenchCard>
      <WorkbenchCard className={`${billing.product} ${billing.monthly}`} glass>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{text("好友首次充值", "Their first top-up")}</h2><span className={`${billing.productBadge} rounded-full px-2.5 py-1 text-[10px] font-medium`}>{text("你的额外奖励", "An extra reward for you")}</span></div>
          <p className={`${billing.price} font-number`}>+{formatPoints(REWARD.firstTopup, locale)}<span className="ml-2 text-xs font-normal text-muted-foreground">{text("积分", "credits")}</span></p>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">{text("好友完成首次充值后，你再得一份积分奖励，感谢你的推荐。", "After your friend completes their first top-up, you receive an additional reward for your recommendation.")}</p>
        {progress(toppedUp)}
      </WorkbenchCard>
    </div>

    <WorkbenchCard aria-labelledby="referral-friends-heading" data-referral-friends>
      <div className={billing.sectionHeading}><h2 id="referral-friends-heading">{text("邀请记录", "Referral activity")}</h2><p className={billing.caption}>{text(`${registered} 位好友 · 示例数据`, `${registered} friends · Sample data`)}</p></div>
      {friends.length === 0 ? <p className={billing.empty} data-referral-empty>{text("还没有邀请记录，复制邀请链接，邀请第一位好友吧。", "No referrals yet. Copy your referral link and invite your first friend.")}</p> : <ul className={billing.records}>
        {friends.map(friend => <li key={friend.id} className={billing.row}>
          <div><h3 className={billing.recordTitle}>{english ? friend.englishName : friend.name}</h3><p className={billing.meta}><time dateTime={friend.date}>{friend.date.replaceAll("-", ".")}</time><span aria-hidden="true"> · </span>{friend.toppedUp ? text("已完成首次充值", "First top-up complete") : text("已注册 · 待首次充值", "Signed up · Awaiting first top-up")}</p></div>
          <div className="text-right"><p className={`${billing.amount} font-number`}>+{formatPoints(REWARD.registration + (friend.toppedUp ? REWARD.firstTopup : 0), locale)}<small>{text("积分", "credits")}</small></p><span className={`${billing.status} text-emerald-700 dark:text-emerald-400`}>{text("已获得 · 演示", "Earned · Demo")}</span></div>
        </li>)}
      </ul>}
    </WorkbenchCard>

    <WorkbenchCard aria-labelledby="referral-rules-heading">
      <div className={billing.sectionHeading}><h2 id="referral-rules-heading">{text("奖励规则", "Reward details")}</h2><p className={billing.caption}>{text("正式规则以活动上线为准", "Final rules will be confirmed at launch")}</p></div>
      <ul className={billing.records}>{[
        { title: text("奖励什么时候到账？", "When do rewards arrive?"), body: text(`演示规则：好友通过邀请链接注册并验证邮箱后，你和好友各得 ${REWARD.registration} 积分；好友首次充值成功后，你再得 ${REWARD.firstTopup} 积分。当前页面仅预览，不发放实际奖励。`, `Preview rules: once a friend signs up through your link and verifies their email, you both get ${REWARD.registration} credits. Their first successful top-up earns you another ${REWARD.firstTopup}. No actual rewards are issued in this preview.`) },
        { title: text("最多可以获得多少奖励？", "How many rewards can I earn?"), body: text(`注册奖励和首次充值奖励各限 ${REWARD.limit} 次，最多可得 ${REWARD.limit * (REWARD.registration + REWARD.firstTopup)} 积分。两项进度独立计算，领满后不会继续累加。`, `Sign-up and first top-up rewards each have a limit of ${REWARD.limit}, for up to ${REWARD.limit * (REWARD.registration + REWARD.firstTopup)} credits in total. Each reward tracks its own progress and stops at its limit.`) },
        { title: text("好友注册后还能补填邀请码吗？", "Can a friend enter a code after signing up?"), body: text("计划支持注册后 7 天内补填一次，每位好友只能关联一个账号，不能填写自己的邀请码。补填功能尚未开放。", "The planned flow allows one code to be entered within 7 days of signing up. Each friend can be linked to one account, and self-referrals are not allowed. Code entry is not available yet.") },
      ].map(item => <li key={item.title}><details className={billing.usage}><summary className={billing.row}><span className={billing.recordTitle}>{item.title}</span><ChevronDown className={billing.chevron} aria-hidden="true" /></summary><p className={`${billing.caption} pb-4`}>{item.body}</p></details></li>)}</ul>
    </WorkbenchCard>

    <div className={styles.previewControls}>
      <p className={billing.caption}>{text("页面预览 · 邀请码和奖励记录为示例，不计入当前账号的积分余额。", "Page preview · The code and reward activity are samples and do not affect your account balance.")}</p>
      <div className={styles.previewSelect}><FilterSelect aria-label={text("预览状态", "Preview state")} value={scenario} onValueChange={setScenario} emptyText={text("没有匹配状态", "No matching states")} options={[
        { value: "active", label: text("已有邀请", "With activity") },
        { value: "empty", label: text("首次邀请", "First invitation") },
        { value: "full", label: text("奖励领满", "All rewards claimed") },
      ]} /></div>
    </div>
  </div>;
}
