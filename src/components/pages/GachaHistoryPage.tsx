"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { RefreshCw, ScanLine, Trash2, Unlink } from "lucide-react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { QrCodeFrame } from "@/components/ui/qr-code-frame";
import { SklandPlayerIdentity, type SklandPlayerIdentityData } from "@/components/skland/SklandPlayerIdentity";
import type { GachaSessionData } from "@/gacha-accounts";
import { StatusCenterHeader } from "@/components/pages/StatusCenterShell";
import { RemoteAvatar } from "@/components/ui/remote-avatar";
import { operatorPortraitFor } from "@/operatorPortraits";
import { SummaryMetric } from "@/components/ui/summary-metric";
import { Switch } from "@/components/ui/switch";
import { PRODUCT_ICON_URLS } from "@/product-assets";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SklandPolicyConsent, currentSklandPolicyConsent } from "@/skland-policy-consent";
import { groupGachaPools, groupGachaSixStarIntervals, visibleGachaIntervalKeys, type GachaHistory, type GachaRecord, type GachaSixStarInterval } from "@/gacha-history";
import { workbenchPageAccent } from "@/workbench-accent";
import styles from "./GachaHistoryPage.module.css";
import titleManifest from "@/generated/gacha-titles.json";
import { analyzeGachaHistory } from "@/gacha-analytics";
import { GachaAnalysisOverview, GachaAnalysisRules, GachaRating } from "./GachaStatistics";

type Scan = { scanId: string; scanUrl: string; expiresInSeconds: number };
type ApiResult<T> = { success: true; data: T } | { success: false; error: { message: string } };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const result = await response.json() as ApiResult<T>;
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

const gachaActionClassName = "!min-w-0 max-w-full max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2";
const gachaToolbarActionClassName = `${styles.toolbarAction} !min-w-0 max-w-full max-md:px-3`;

const poolTitleAssets = titleManifest.titles as Record<string, { accent?: string | null }>;

function PoolStatValue({ label, value, mobileDigits }: { label: string; value: number; mobileDigits: number }) {
  const gradientId = useId();
  const mobileText = useRef<SVGTextElement>(null);
  const [fontMetrics, setFontMetrics] = useState({ advance: .8, ascent: .8, descent: .04 });
  const [mobileLabelShift, setMobileLabelShift] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled || !mobileText.current) return;
      const font = getComputedStyle(mobileText.current);
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      context.font = `${font.fontStyle} ${font.fontWeight} 100px ${font.fontFamily}`;
      const digits = [..."0123456789"].map((digit) => context.measureText(digit));
      setFontMetrics({
        advance: Math.max(...digits.map((digit) => Math.max(digit.width, digit.actualBoundingBoxRight))) / 100,
        ascent: Math.max(...digits.map((digit) => digit.actualBoundingBoxAscent)) / 100,
        descent: Math.max(...digits.map((digit) => digit.actualBoundingBoxDescent)) / 100,
      });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const text = mobileText.current;
    const frame = text?.closest("dd");
    if (!text || !frame) return;
    const observer = new ResizeObserver(() => {
      const bounds = text.getBoundingClientRect();
      setMobileLabelShift(bounds.width > 0 ? Math.max(0, bounds.left - frame.getBoundingClientRect().left) : 0);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [fontMetrics, mobileDigits, value]);
  const mobileTextWidth = mobileDigits * (fontMetrics.advance + .01) + .05;
  return <><dt className="text-xs text-muted-foreground" style={{ "--gacha-label-shift": `${mobileLabelShift}px` } as CSSProperties}>{label}</dt>
  <dd className={`${styles.poolStatValue} font-number`} title={`${label}：${value}`} aria-label={String(value)}>
    <span aria-hidden="true">{value}</span>
    <svg className={styles.poolStatOutline} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--gacha-stat-highlight)" />
          <stop offset="45%" stopColor="currentColor" />
          <stop offset="100%" stopColor="var(--gacha-stat-shadow)" />
        </linearGradient>
      </defs>
      <text className={styles.poolStatDesktop} x="2.5%" y="0" textLength="95%" lengthAdjust="spacingAndGlyphs" dominantBaseline="text-before-edge" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1" strokeLinejoin="round">{value}</text>
      <svg className={styles.poolStatMobile} viewBox={`0 ${-fontMetrics.ascent - .025} ${mobileTextWidth} ${fontMetrics.ascent + fontMetrics.descent + .05}`} preserveAspectRatio="none" width="100%" height="100%">
        <text ref={mobileText} x={mobileTextWidth - .025} y="0" textAnchor="end" style={{ fontSize: "1px", letterSpacing: ".01px" }} fill="none" stroke={`url(#${gradientId})`} strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round">{value}</text>
      </svg>
    </svg>
  </dd></>;
}

function DrawPortrait({ record, large = false, offBanner = false }: { record: GachaRecord; large?: boolean; offBanner?: boolean }) {
  return <div className="relative" title={`${record.charName} · ${record.stars}★${record.isNew ? " · NEW" : ""}`} data-gacha-record data-gacha-stars={record.stars}>
    <RemoteAvatar src={operatorPortraitFor(record.charName, record.charId)} alt={`${record.charName}头像`} pixelSize={large ? 40 : 28} loading="lazy" className={`${large ? "size-10" : "size-7"} rounded-[4px] bg-muted`} emptyFallback={<span aria-hidden="true" className="text-xs text-muted-foreground">{record.charName.slice(0, 1)}</span>} />
    {offBanner && <span data-gacha-off-banner aria-label="非本卡池 UP 六星" className="absolute -right-1 -top-1 z-10 grid size-4 place-items-center rounded-[2px] bg-destructive text-[10px] font-semibold leading-none text-white">歪</span>}
  </div>;
}

function GachaDrawIntervals({ intervals, showFiveStars }: { intervals: GachaSixStarInterval[]; showFiveStars: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<Array<{ key: string; count: number; top: number; height: number }>>([]);
  const hasMulti = intervals.some((interval) => interval.multiSixStarBatchKey !== null);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const bars = new Map([...root.querySelectorAll<HTMLElement>("[data-gacha-interval-key]")].map((node) => [node.dataset.gachaIntervalKey, node.getBoundingClientRect()]));
      const groups = new Map<string, GachaSixStarInterval[]>();
      for (const interval of intervals) {
        if (!interval.multiSixStarBatchKey) continue;
        const batch = groups.get(interval.multiSixStarBatchKey) ?? [];
        batch.push(interval);
        groups.set(interval.multiSixStarBatchKey, batch);
      }
      const next = [...groups].flatMap(([key, batch]) => {
        if (batch.length < 2 || batch.length !== batch[0].multiSixStarCount) return [];
        const first = bars.get(batch[0].key);
        const last = bars.get(batch[batch.length - 1].key);
        if (!first || !last) return [];
        const top = first.top - bounds.top;
        return [{ key, count: batch.length, top, height: last.bottom - bounds.top - top }];
      });
      setLinks((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const row of root.querySelectorAll<HTMLElement>("[data-gacha-interval]")) observer.observe(row);
    return () => observer.disconnect();
  }, [intervals, showFiveStars]);
  return <div ref={container} className={styles.poolRecords} data-multi-six={hasMulti || undefined} role="list" aria-label="六星寻访分段，最近在前">
    {intervals.map((interval) => {
      if (!interval.sixStar) return null;
      const color = interval.drawCount <= 30 ? workbenchPageAccent("gacha") : interval.drawCount <= 60 ? workbenchPageAccent("calculator") : "var(--destructive)";
      return <div key={interval.key} data-gacha-interval role="listitem" aria-label={`${interval.sixStar.charName}，记录内${interval.drawCount}抽`} className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-4 max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:py-3">
      <div className={showFiveStars && interval.lowerStars.length > 0 ? "row-span-2" : undefined}>
        <DrawPortrait record={interval.sixStar} large offBanner={interval.offBanner} />
      </div>
      <div className={`${styles.drawBar} relative flex h-10 min-w-0 items-center overflow-hidden`} style={{ "--gacha-accent": color, "--gacha-saturation": interval.drawCount <= 60 ? 2.3 : 1.45 } as CSSProperties} data-gacha-draw-bar data-gacha-interval-key={interval.key}>
        <div aria-hidden="true" className={`${styles.drawFill} absolute inset-y-0 left-0`} style={{ width: `${Math.min(100, interval.drawCount / 80 * 100)}%`, minWidth: "min(100%, calc(5rem + var(--gacha-bar-cut)))", backgroundColor: "var(--gacha-bar-fill)" } as CSSProperties} />
        <span className="relative z-10 flex items-baseline gap-2 whitespace-nowrap px-3" style={{ color: "var(--gacha-bar-foreground, var(--foreground))" }}><strong className="font-number text-xl font-semibold leading-none tabular-nums">{interval.drawCount}</strong><span className="text-xs font-medium opacity-75">抽</span></span>
      </div>
      {showFiveStars && interval.lowerStars.length > 0 && <div className="col-start-2 flex min-w-0 flex-wrap gap-1.5" role="list" aria-label="本段五星干员">
        {interval.lowerStars.map((record) => <div key={record.id} role="listitem" aria-label={`${record.charName}，${record.stars}星`}><DrawPortrait record={record} /></div>)}
      </div>}
    </div>; })}
    {links.map((link) => <div key={link.key} className={styles.multiSixLink} data-gacha-multi-six style={{ top: link.top, height: link.height }}>
      <span className={styles.multiSixLabel}>十连{["", "", "二", "三", "四", "五", "六", "七", "八", "九", "十"][link.count]}金</span>
    </div>)}
  </div>;
}

export default function GachaHistoryPage({ uid, accountId, player, syncedAt = null, onCopyUid, identityError, onRetryIdentity }: {
  uid: string; accountId?: string; player?: SklandPlayerIdentityData; syncedAt?: number | null;
  onCopyUid?: (uid: string) => void; identityError?: string | null; onRetryIdentity?: () => void;
}) {
  const selectedUid = uid;
  const [authorizedUids, setAuthorizedUids] = useState<string[]>([]);
  const authorized = authorizedUids.includes(selectedUid);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [gachaConsent, setGachaConsent] = useState(false);
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [syncingSkland, setSyncingSkland] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRequest = useRef<AbortController | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanStatus, setScanStatus] = useState("idle");
  const [syncAfterScan, setSyncAfterScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedHistory, setHistory] = useState<GachaHistory | null>(null);
  const history = storedHistory?.uid === selectedUid ? storedHistory : null;
  const [loading, setLoading] = useState(true);
  const historyRequest = useRef(0);
  const [visibleCount, setVisibleCount] = useState(10);
  const [showFiveStars, setShowFiveStars] = useState(true);

  useEffect(() => () => scanRequest.current?.abort(), []);

  const changeAuthorizationOpen = useCallback((open: boolean) => {
    setAuthorizationOpen(open);
    if (!open) {
      scanRequest.current?.abort();
      scanRequest.current = null;
      setScan(null);
      setScanStatus("idle");
      setScanBusy(false);
      setSyncingSkland(false);
      setScanError(null);
      setTerms(false);
      setPrivacy(false);
      setGachaConsent(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api<GachaSessionData>("/api/gacha/session")
      .then((result) => {
        if (!active) return;
        setAuthorizedUids(result.authorizedUids);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "云端账号读取失败，请刷新页面重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setVisibleCount(10);
    setHistory(null); setError(null);
    const sequence = ++historyRequest.current;
    if (!selectedUid) return;
    const controller = new AbortController();
    setLoading(true);
    void api<GachaHistory | null>(`/api/gacha/history?${new URLSearchParams({ uid: selectedUid })}`, { signal: controller.signal })
      .then((result) => { if (sequence === historyRequest.current) setHistory(result); })
      .catch((cause) => { if (!controller.signal.aborted && sequence === historyRequest.current) setError(cause instanceof Error ? cause.message : "云端记录读取失败。"); })
      .finally(() => { if (sequence === historyRequest.current) setLoading(false); });
    return () => { controller.abort(); };
  }, [selectedUid]);

  const refresh = useCallback(async () => {
    if (!selectedUid) return;
    const sequence = ++historyRequest.current;
    setBusy(true); setLoading(false); setError(null);
    try {
      const incoming = await api<GachaHistory>(`/api/gacha/history?${new URLSearchParams({ uid: selectedUid })}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }),
      });
      if (sequence === historyRequest.current) setHistory(incoming);
    } catch (cause) { if (sequence === historyRequest.current) setError(cause instanceof Error ? cause.message : "寻访记录读取失败。"); }
    finally { setBusy(false); }
  }, [selectedUid]);

  function acceptAuthorization(result: { roles: Array<{ uid: string; nickname: string }>; selectedUid?: string }) {
    setAuthorizedUids(result.roles.map((role) => role.uid));
    if (!result.roles.some((role) => role.uid === selectedUid)) throw new Error("授权账号与森空岛状态中心当前角色不一致，请使用对应账号授权。切换账号请前往森空岛状态中心。");
    setSyncAfterScan(true);
  }

  async function clearHistory() {
    if (!window.confirm(`删除角色 ${selectedUid} 的全部云端寻访记录？此操作无法撤销。账号绑定将保留。`)) return;
    const sequence = ++historyRequest.current;
    setBusy(true); setLoading(false); setError(null);
    try {
      await api(`/api/gacha/history?${new URLSearchParams({ uid: selectedUid })}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmUid: selectedUid }) });
      if (sequence === historyRequest.current) setHistory(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "云端记录删除失败。"); }
    finally { setBusy(false); }
  }

  async function startScan() {
    if (!authorizationOpen || !terms || !privacy || !gachaConsent) return;
    scanRequest.current?.abort();
    const controller = new AbortController();
    scanRequest.current = controller;
    setScanBusy(true); setScanError(null); setScan(null);
    try {
      const result = await api<Scan>("/api/gacha/qr", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ consent: currentSklandPolicyConsent(), gachaConsent: true }),
      });
      if (controller.signal.aborted) return;
      setScan(result); setScanStatus("waiting");
    } catch (cause) {
      if (!controller.signal.aborted) setScanError(cause instanceof Error ? cause.message : "二维码生成失败。");
    } finally {
      if (scanRequest.current === controller) { scanRequest.current = null; setScanBusy(false); }
    }
  }

  async function syncFromSkland() {
    if (!authorizationOpen || !terms || !privacy || !gachaConsent) return;
    scanRequest.current?.abort();
    const controller = new AbortController();
    scanRequest.current = controller;
    setScanBusy(true); setSyncingSkland(true); setScanError(null); setScan(null);
    try {
      const result = await api<{ roles: Array<{ uid: string; nickname: string }>; selectedUid: string }>("/api/gacha/skland", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ consent: currentSklandPolicyConsent(), gachaConsent: true,
          ...(selectedUid ? { uid: selectedUid } : {}),
          ...(accountId ? { accountId } : {}) }),
      });
      if (controller.signal.aborted) return;
      acceptAuthorization(result);
      changeAuthorizationOpen(false);
    } catch (cause) {
      if (!controller.signal.aborted) setScanError(cause instanceof Error ? cause.message : "森空岛登录状态同步失败，请尝试扫码授权。");
    } finally {
      if (scanRequest.current === controller) { scanRequest.current = null; setScanBusy(false); setSyncingSkland(false); }
    }
  }

  useEffect(() => {
    if (!authorizationOpen || !scan || scanStatus === "authenticated" || scanStatus === "expired") return;
    const controller = new AbortController();
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api<{ status: string; roles: Array<{ uid: string; nickname: string }> }>("/api/gacha/qr/status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ scanId: scan.scanId }),
        });
        if (cancelled) return;
        setScanStatus(result.status);
        if (result.status === "authenticated") {
          setAuthorizedUids(result.roles.map((role) => role.uid));
          if (!result.roles.some((role) => role.uid === selectedUid)) {
            setScanError("扫码账号与森空岛状态中心当前角色不一致，请使用对应账号扫码。切换账号请前往森空岛状态中心。");
            setScan(null);
            return;
          }
          changeAuthorizationOpen(false);
          setSyncAfterScan(true);
        }
      } catch (cause) {
        if (!cancelled) { setScanError(cause instanceof Error ? cause.message : "扫码状态读取失败。"); setScan(null); }
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [authorizationOpen, scan, scanStatus, selectedUid, changeAuthorizationOpen]);

  useEffect(() => {
    if (!syncAfterScan || !authorized || !selectedUid) return;
    setSyncAfterScan(false);
    void refresh();
  }, [syncAfterScan, authorized, selectedUid, refresh]);

  async function disconnect() {
    setBusy(true);
    try {
      await api<{ disconnected: boolean }>("/api/gacha/session", { method: "DELETE" });
      setAuthorizedUids([]); setScan(null); setScanStatus("idle");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "解除授权失败。"); }
    finally { setBusy(false); }
  }

  const pools = useMemo(() => groupGachaPools(history?.records ?? []), [history]);
  const mobileStatDigits = pools.reduce((digits, pool) => Math.max(digits, String(pool.records.length).length), 2);
  const analysis = useMemo(() => analyzeGachaHistory(history?.records ?? []), [history]);
  const recordStartedLabel = analysis.startedAt === null ? null : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(analysis.startedAt).replaceAll("/", ".");
  const matchingPools = useMemo(() => pools.map((group) => ({
    ...group,
    intervals: groupGachaSixStarIntervals(group.records).map((interval) => ({
      ...interval,
      lowerStars: interval.lowerStars.filter((record) => record.stars >= 5),
    })).filter((interval) => interval.sixStar !== null),
  })), [pools]);
  const matchingCount = matchingPools.reduce((count, group) => count + group.intervals.length, 0);
  const visibleIds = visibleGachaIntervalKeys(matchingPools.flatMap((group) => group.intervals), visibleCount);
  const visiblePools = matchingPools.map((group) => ({
    ...group,
    intervals: group.intervals.filter((interval) => visibleIds.has(interval.key)),
  })).filter((group) => group.intervals.length > 0 || group.sixStars === 0);
  const sixStars = history?.records.filter((record) => record.stars === 6).length ?? 0;
  const fiveStars = history?.records.filter((record) => record.stars === 5).length ?? 0;
  const fourStars = history?.records.filter((record) => record.stars === 4).length ?? 0;
  const threeStars = history?.records.filter((record) => record.stars === 3).length ?? 0;

  return <section className={`${styles.page} flex w-full min-w-0 flex-col gap-3 bg-background pb-8 pt-3 text-foreground`} data-gacha-history>
    <StatusCenterHeader data-ui-number-font className="items-start gap-2 pb-3 lg:items-start [&_[data-status-center-actions]]:min-h-0 [&_[data-status-center-actions]]:content-start [&_[data-status-center-identity]]:min-h-0 [&_[data-status-center-identity]]:items-start [&_[data-skland-player-identity]]:items-start"
      identity={player && onCopyUid ? <SklandPlayerIdentity player={player} syncedAt={syncedAt} onCopyUid={onCopyUid}
        nameBadge={<GachaRating average={analysis.current.sixAverage} scope="current" currentDraws={loading || error ? undefined : analysis.current.draws} />}
        extraMetadata={recordStartedLabel && <span className="whitespace-nowrap" data-gacha-record-start>记录始于 <time dateTime={new Date(analysis.startedAt!).toISOString()}>{recordStartedLabel}</time></span>} /> : null}
      actions={
      <div className={`${styles.actionToolbar} ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5 max-lg:ml-0 max-lg:w-full max-lg:justify-start`} role="group" aria-label="寻访记录操作">
        {authorizedUids.length > 0 && <SetupActionButton type="button" variant="ghost" className={`${gachaToolbarActionClassName} text-muted-foreground`} data-gacha-action="disconnect" aria-label="解除授权" title="解除授权" disabled={busy} onClick={() => void disconnect()}><Unlink className="sm:hidden" /><span className={styles.actionLabel}>解除授权</span></SetupActionButton>}
        {history && <SetupActionButton type="button" variant="ghost" className={`${gachaToolbarActionClassName} text-muted-foreground hover:text-destructive`} data-gacha-action="delete" disabled={busy || loading} aria-label="删除云端寻访记录" title="删除云端寻访记录" onClick={() => void clearHistory()}><Trash2 /><span className={styles.actionLabel}>删除</span></SetupActionButton>}
        <Dialog open={authorizationOpen} onOpenChange={changeAuthorizationOpen}>
          <DialogTrigger render={<SetupActionButton type="button" variant={authorized ? "outline" : "default"} aria-label="授权记录" title="授权记录" disabled={busy} className={gachaToolbarActionClassName} />}><ScanLine /><span className={styles.actionLabel}>授权记录</span></DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(720px,calc(100vw-2rem))]">
            <DialogHeader>
              <DialogTitle>授权寻访记录</DialogTitle>
              <DialogDescription>使用森空岛 App 扫码确认后，自动读取寻访记录；也可同步本站已登录的森空岛账号。</DialogDescription>
            </DialogHeader>
            <DialogBody className="min-h-0 overflow-y-auto pb-5 sm:pb-7">
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_224px]">
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-muted-foreground">寻访记录上传后绑定当前网站账号，长期保存在服务器，不随授权过期而删除；登录同一网站账号即可跨设备查看。再次授权只用于更新记录。你可以删除记录；解除授权不会删除云端历史。</p>
                  <SklandPolicyConsent termsAccepted={terms} privacyAccepted={privacy} onTermsChange={setTerms} onPrivacyChange={setPrivacy} />
                  <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={gachaConsent} onChange={(event) => setGachaConsent(event.target.checked)} />我同意读取寻访记录，绑定当前网站账号并保存在服务器。</label>
                  <div className="flex flex-wrap gap-3">
                    <SetupActionButton type="button" className={gachaActionClassName} disabled={!terms || !privacy || !gachaConsent || scanBusy} onClick={() => void syncFromSkland()}><RefreshCw className={syncingSkland ? "animate-spin" : ""} />{syncingSkland ? "正在同步登录状态" : "同步本站森空岛登录状态"}</SetupActionButton>
                    <SetupActionButton type="button" variant="outline" className={gachaActionClassName} disabled={!terms || !privacy || !gachaConsent || scanBusy} onClick={() => void startScan()}><ScanLine />{scanBusy && !syncingSkland ? "正在生成二维码" : scan ? "刷新二维码" : "生成二维码"}</SetupActionButton>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">已登录森空岛可先尝试同步；如缺少授权或授权已失效，请点击“生成二维码”。</p>
                  {scan && <p role="status" className="text-sm text-muted-foreground">{scanStatus === "scanned" ? "已扫码，请在手机上确认" : scanStatus === "expired" ? "二维码已过期，请刷新" : "等待扫码确认"}</p>}
                </div>
                <QrCodeFrame className="self-start justify-self-center max-sm:order-first" data-gacha-qr>{scan ? <QRCodeSVG value={scan.scanUrl} size={196} marginSize={1} className="size-full" /> : <ScanLine className="size-12 text-neutral-700 [forced-color-adjust:none]" />}</QrCodeFrame>
              </div>
              {scanError && <p role="alert" className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{scanError}</p>}
            </DialogBody>
          </DialogContent>
        </Dialog>
        {authorized && <SetupActionButton type="button" className={`${gachaToolbarActionClassName} max-lg:ml-auto`} aria-label="刷新" title="刷新" disabled={busy} onClick={() => void refresh()}><RefreshCw className={busy ? "animate-spin" : ""} /><span className={styles.actionLabel}>刷新</span></SetupActionButton>}
      </div>
    } />
    {identityError && <p role="alert" className="text-sm text-muted-foreground">账号资料暂时无法同步：{identityError} <button type="button" className="underline underline-offset-4" onClick={onRetryIdentity}>重新同步</button></p>}
    {!history && <p className="border-y border-border py-12 text-center text-sm text-muted-foreground">{loading ? "正在读取云端记录…" : authorized ? "暂无已保存的寻访记录，点击刷新读取。" : "暂无已保存的寻访记录，点击“授权记录”开始读取。"}</p>}
    {error && <p role="alert" className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {history && <>
      <div className={styles.statistics} data-gacha-statistics>
      <section aria-label="已保存寻访统计" data-gacha-summary className="overflow-hidden border border-[#313131]/18 bg-[#F3F1EA] text-[#313131] shadow-[0_12px_30px_rgba(35,38,39,0.10)]">
        <div className="grid grid-cols-6 sm:grid-cols-5">
          {[
            { id: "orundum", label: "总消耗合成玉", value: (history.records.length * 600).toLocaleString("zh-CN") },
            { id: "career-score", label: "生涯评分", value: <GachaRating average={analysis.career.sixAverage} scope="career" /> },
            { id: "draws", label: "已保存寻访", value: history.records.length.toLocaleString("zh-CN") },
            { id: "six-stars", label: "六星干员", value: sixStars.toLocaleString("zh-CN") },
            { id: "lower-stars", label: "五星 / 四星 / 三星", value: `${fiveStars} / ${fourStars} / ${threeStars}` },
          ].map((metric) => <div key={metric.id} data-gacha-summary-metric={metric.id} className={`${styles.summaryMetric} relative col-span-2 min-w-0 border-r border-[#313131]/10 last:border-r-0 sm:col-span-1 max-sm:[&:nth-child(-n+2)]:col-span-3 max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(n+3)]:border-t`}>
            <SummaryMetric label={metric.label} value={metric.value} unit={metric.id === "orundum" ? "折算" : metric.id === "lower-stars" ? <Switch size="sm" checked={showFiveStars} onCheckedChange={setShowFiveStars} aria-label="显示五星寻访记录" title="在卡池卡片中显示五星寻访记录" className="ml-1 data-checked:bg-[#313131] data-unchecked:bg-[#313131]/20" /> : undefined} reserveIconSpace={metric.id === "orundum"} />
            {metric.id === "orundum" && <Image src={PRODUCT_ICON_URLS.orundum} alt="合成玉" width={24} height={24} unoptimized className="pointer-events-none absolute right-1.5 top-1.5 size-6 object-contain opacity-75" />}
          </div>)}
        </div>
      </section>
      <GachaAnalysisOverview analysis={analysis} />
      </div>
      {history.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700">{warning}</p>)}
      <div className="grid min-w-0 gap-3">
        {visiblePools.map((group) => <section key={group.key} className={`${styles.poolCard} infra-room-surface min-w-0 overflow-hidden`} aria-label={group.name} data-gacha-pool-card style={{ "--gacha-pool-accent": poolTitleAssets[group.records[0]?.poolId ?? ""]?.accent ?? "var(--infra-room-text-muted)" } as CSSProperties}>
          <header className={styles.poolHeader}>
            <div className={styles.poolIdentity}>
              <h4 className={`${styles.poolTitle} min-w-0 max-w-full break-words`}>{group.name}</h4>
              {(group.upSixStars.length > 0 || group.upFiveStars.length > 0) && <div className={styles.poolInfo} role="list" aria-label="卡池 UP 干员">
                {[...new Set([...group.upSixStars, ...group.upFiveStars])].map((name) => <div key={name} role="listitem" aria-label={name} title={name}>
                  <RemoteAvatar src={operatorPortraitFor(name)} alt={`${name}头像`} pixelSize={24} loading="lazy" className="size-6 rounded-[3px] bg-muted" emptyFallback={<span aria-hidden="true" className="text-[10px] text-muted-foreground">{name.slice(0, 1)}</span>} />
                </div>)}
              </div>}
              <p className={styles.poolPeriod} aria-label="卡池开放日期" title="北京时间（UTC+8）">{group.period ?? "开放日期待补充"}</p>
            </div>
              <dl className={styles.poolStats} aria-label="卡池统计">
                <div className={styles.poolStat}><PoolStatValue label="累计抽数" value={group.records.length} mobileDigits={mobileStatDigits} /></div>
              </dl>
          </header>
          <GachaDrawIntervals intervals={group.intervals} showFiveStars={showFiveStars} />
        </section>)}
        {!pools.length && <p className="border-y border-border py-12 text-center text-sm text-muted-foreground">暂无寻访记录</p>}
      </div>
      {matchingCount > visibleIds.size && <div className="text-center"><SetupActionButton type="button" variant="outline" className={gachaActionClassName} onClick={() => setVisibleCount((count) => count + 10)}>加载更多</SetupActionButton></div>}
      <p className="text-xs text-muted-foreground">UP 按卡池 ID 匹配游戏卡池资料；资料缺失的卡池只显示原名。</p>
      <p className="text-xs text-muted-foreground">按六星分段，最近在前；下方仅展示两次六星之间的五星干员，每个头像代表一次寻访，抽数包含所有星级。最早分段的抽数仅统计已保存部分。</p>
      <GachaAnalysisRules analysis={analysis} />
    </>}
  </section>;
}
