"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowUpRight, Check, ChevronDown, Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale } from "use-intl";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { clearReferralCode, normalizeReferralCode, rememberReferralCode } from "@riic/shell/auth/referral-code";
import type Messages from "../../../messages/zh-CN/AK_components_referral_ReferralPage.json";
import { formatPoints } from "@/billing-points";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { copyText } from "@/download";
import { trackTelemetry } from "@/lib/telemetry-dispatch";
import { useWebsiteSession } from "@/website-session";
import { readReferral, type ReferralData } from "./referral-client";
import billing from "@/components/billing/BillingPrototype.module.css";
import styles from "./ReferralPage.module.css";

const text = createLocalizer<typeof Messages>("AK_components_referral_ReferralPage");
const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => "";
const statusLabels = {
  pending: "status_pending", qualified: "status_qualified", rewarded: "status_rewarded",
  rejected: "status_rejected", capped: "status_capped",
} as const;

export function ReferralPage() {
  const locale = useLocale();
  const { data: session, isPending } = useWebsiteSession();
  const features = useFeatureAccess();
  return <section className={`${billing.page} grid min-w-0 w-full content-start gap-4 pt-2 pb-8 md:gap-6 md:pt-5`} data-referral-page>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <WorkbenchPageHeading page="referral" accentColor="var(--billing-highlight)">{text.text(locale, "title")}</WorkbenchPageHeading>
        <p className="mt-2 text-sm text-muted-foreground">{text.text(locale, "description")}</p>
      </div>
      {session ? <div className="flex flex-wrap gap-2"><SetupActionButton nativeButton={false} variant="outline" className="!min-w-0" render={<Link to="/skland" />}>{text.text(locale, "authenticate")}<ArrowUpRight className="size-3.5" /></SetupActionButton>{features.billing ? <SetupActionButton nativeButton={false} variant="outline" className="!min-w-0" render={<Link to="/billing" />}>{text.text(locale, "wallet")}<ArrowUpRight className="size-3.5" /></SetupActionButton> : null}</div> : null}
    </header>
    {isPending ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">{text.text(locale, "loading")}</p> : <ReferralContent key={session?.user.id ?? "guest"} signedIn={Boolean(session)} />}
  </section>;
}

function ReferralContent({ signedIn }: { signedIn: boolean }) {
  const locale = useLocale();
  const search = useLocation({ select: location => location.searchStr });
  const [data, setData] = useState<ReferralData | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const landed = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void readReferral(controller.signal).then(next => { setData(next); setFailed(false); }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    if (signedIn) { clearReferralCode(); return; }
    // Preserve navigation attribution before the campaign request completes.
    // Signup admission and reward eligibility are checked by the server.
    rememberReferralCode(new URLSearchParams(search).get("ref"));
  }, [search, signedIn]);

  useEffect(() => {
    if (signedIn || !data?.enabled) return;
    const code = normalizeReferralCode(new URLSearchParams(search).get("ref"));
    if (!code) return;
    if (!landed.current) {
      landed.current = true;
      trackTelemetry({ type: "navigation", name: "referral_landing", page: "/referral" });
    }
  }, [data?.enabled, search, signedIn]);

  if (failed) return <WorkbenchCard><p role="alert" className="text-sm text-destructive">{text.text(locale, "unavailable")}</p><SetupActionButton variant="outline" className="mt-4" onClick={() => { setFailed(false); setRevision(value => value + 1); }}>{text.text(locale, "retry")}</SetupActionButton></WorkbenchCard>;
  if (!data) return <p role="status" className="py-8 text-center text-sm text-muted-foreground">{text.text(locale, "loading")}</p>;
  return <>
    {!data.enabled ? <WorkbenchCard data-referral-disabled><h2 className="text-sm font-semibold">{text.text(locale, "paused")}</h2><p className={`${billing.caption} mt-2`}>{text.text(locale, "pausedDescription")}</p></WorkbenchCard> : null}
    {data.account ? <ReferralAccount data={data} account={data.account} /> : data.enabled ? <WorkbenchCard data-referral-sign-in>
      <h2 className="text-sm font-semibold">{text.text(locale, "joinTitle")}</h2>
      <p className={`${billing.caption} mt-2`}>{text.text(locale, "joinDescription", { points: data.rewardPoints, max: data.maxPoints })}</p>
      <SetupActionButton variant="outline" className="mt-5" onClick={event => requestAccountSignIn(event.currentTarget)}>{text.text(locale, "signIn")}</SetupActionButton>
    </WorkbenchCard> : null}
    <WorkbenchCard aria-labelledby="referral-rules-heading">
      <div className={billing.sectionHeading}><h2 id="referral-rules-heading">{text.text(locale, "rules")}</h2></div>
      <ul className={billing.records}>{(["eligibility", "limits", "pause"] as const).map(key => <li key={key}><details className={billing.usage}><summary className={billing.row}><span className={billing.recordTitle}>{text.text(locale, `${key}Title`)}</span><ChevronDown className={billing.chevron} aria-hidden="true" /></summary><p className={`${billing.caption} pb-4`}>{text.text(locale, `${key}Body`, { points: data.rewardPoints, count: data.rewardLimit, max: data.maxPoints })}</p></details></li>)}</ul>
    </WorkbenchCard>
  </>;
}

function ReferralAccount({ data, account }: { data: ReferralData; account: NonNullable<ReferralData["account"]> }) {
  const locale = useLocale();
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copying = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, serverOrigin);
  const referralLink = `${origin}/referral?ref=${encodeURIComponent(account.code)}`;
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(kind: "link" | "code") {
    if (copying.current || !data.enabled) return;
    copying.current = true;
    clearTimeout(timer.current);
    setCopied(null);
    setCopyFailed(false);
    try {
      await copyText(kind === "link" ? referralLink : account.code);
      setCopied(kind);
      trackTelemetry({ type: "interaction", name: "referral_share", page: "/referral" });
      timer.current = setTimeout(() => setCopied(null), 2500);
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyFailed(true);
    } finally { copying.current = false; }
  }

  return <div className="contents" data-referral-account>
    <WorkbenchCard className={billing.wallet} aria-label={text.text(locale, "overview")}>
      <div className={billing.available}>
        <h2 className={billing.caption}>{text.text(locale, "earned")}</h2>
        <p className={`${billing.balance} font-number`} data-referral-earned>{formatPoints(account.earnedPoints, locale)}<small>{text.text(locale, "points")}</small></p>
        <p className={`${billing.caption} mt-3`}>{text.text(locale, "permanent")}</p>
      </div>
      <dl className={billing.walletDetails}>
        <div><dt className={billing.caption}>{text.text(locale, "registered")}</dt><dd className={`${billing.balance} font-number`}>{account.registeredCount}<small>{text.text(locale, "people")}</small></dd></div>
        <div><dt className={billing.caption}>{text.text(locale, "qualified")}</dt><dd className={`${billing.balance} font-number`}>{account.qualifiedCount}<small>{text.text(locale, "people")}</small></dd><dd className={`${billing.caption} mt-2`}>{text.text(locale, "rewarded", { count: account.rewardedCount, max: data.rewardLimit })}</dd></div>
      </dl>
    </WorkbenchCard>
    {data.enabled ? <WorkbenchCard aria-labelledby="referral-link-heading">
      <div className={billing.sectionHeading}><h2 id="referral-link-heading">{text.text(locale, "invite")}</h2><p className={billing.caption}>{text.text(locale, "shareDescription")}</p></div>
      <div className={styles.invitationRow}>
        <Input ref={linkInput} aria-label={text.text(locale, "link")} className={styles.linkInput} value={referralLink} readOnly onFocus={event => event.currentTarget.select()} spellCheck={false} />
        <SetupActionButton className={`${billing.primary} ${styles.copyButton}`} onClick={() => void copy("link")} data-referral-copy>{copied === "link" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{text.text(locale, copied === "link" ? "copied" : "copyLink")}</SetupActionButton>
        <Dialog>
          <DialogTrigger render={<Button variant="outline" className={billing.pill} aria-label={text.text(locale, "showQr")} />}><QrCode aria-hidden="true" />{text.text(locale, "qr")}</DialogTrigger>
          <DialogContent className={styles.qrDialog} closeLabel={text.text(locale, "close")}>
            <DialogHeader><DialogTitle>{text.text(locale, "invite")}</DialogTitle><DialogDescription>{text.text(locale, "qrDescription")}</DialogDescription></DialogHeader>
            <DialogBody><div className={styles.qrCode}><QRCodeSVG value={referralLink} size={216} marginSize={2} title={text.text(locale, "showQr")} /></div><p className="break-all text-center text-xs text-muted-foreground">{text.text(locale, "code")} <strong>{account.code}</strong></p></DialogBody>
            <DialogFooter><SetupActionButton variant="outline" className="w-full" onClick={() => void copy("link")}>{copied === "link" ? <Check /> : <Copy />}{text.text(locale, copied === "link" ? "copied" : "copyLink")}</SetupActionButton></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className={styles.codeRow}><p className={billing.caption}>{text.text(locale, "code")}<span className={`${styles.code} break-all`}>{account.code}</span></p><Button variant="ghost" size="sm" className={styles.copyCode} onClick={() => void copy("code")}>{copied === "code" ? <Check /> : <Copy />}{text.text(locale, copied === "code" ? "copied" : "copyCode")}</Button></div>
      {copied ? <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{text.text(locale, "copied")}</p> : null}
      {copyFailed ? <p role="alert" className="mt-3 text-xs text-destructive">{text.text(locale, "copyFailed")}</p> : null}
    </WorkbenchCard> : null}
    <WorkbenchCard className={`${billing.product} ${billing.testPack}`} glass>
      <h2 className="text-sm font-semibold">{text.text(locale, "rewardTitle")}</h2>
      <p className={`${billing.price} font-number`}>+{formatPoints(data.rewardPoints, locale)}<span className="ml-2 text-xs font-normal text-muted-foreground">{text.text(locale, "perPerson")}</span></p>
      <p className="text-xs leading-6 text-muted-foreground">{text.text(locale, "rewardDescription", { max: data.maxPoints })}</p>
      <div className={styles.progress} aria-label={text.text(locale, "rewarded", { count: account.rewardedCount, max: data.rewardLimit })}>
        <div className={styles.segments} aria-hidden="true">{Array.from({ length: data.rewardLimit }, (_, index) => <span key={index} data-filled={index < account.rewardedCount || undefined} />)}</div>
        <span className={billing.caption}>{text.text(locale, account.remainingRewards === 0 ? "full" : "remaining", { count: account.remainingRewards })}</span>
      </div>
    </WorkbenchCard>
    <WorkbenchCard aria-labelledby="referral-records-heading" data-referral-records>
      <div className={billing.sectionHeading}><h2 id="referral-records-heading">{text.text(locale, "records")}</h2></div>
      {account.referrals.length === 0 ? <p className={billing.empty} data-referral-empty>{text.text(locale, "empty")}</p> : <ul className={billing.records}>{account.referrals.map(record => <li key={record.id} className={billing.row} data-referral-status={record.status}>
        <div><h3 className={billing.recordTitle}>{text.text(locale, statusLabels[record.status])}</h3><p className={billing.meta}><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString(locale)}</time></p></div>
        <p className={`${billing.amount} font-number`}>+{formatPoints(record.points, locale)}<small>{text.text(locale, "points")}</small></p>
      </li>)}</ul>}
    </WorkbenchCard>
  </div>;
}
