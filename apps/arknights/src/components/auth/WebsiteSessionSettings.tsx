"use client";

import { requestAccountSignIn } from "@riic/shell/account-sign-in";
import { reportAccountActivity } from "@riic/shell/account-activity";
import { Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";

import { InfraTechnicalCard, InfraTechnicalHeading } from "@/components/InfraTechnicalCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWebsiteSession } from "@/website-session";

function formatExpiry(value: Date | string, locale: "zh" | "en"): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function remainingParts(value: Date | string, now: number) {
  const expiresAt = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { expired: true, days: 0, hours: 0, minutes: 0 };
  const minutes = Math.floor((expiresAt - now) / 60_000);
  return {
    expired: false,
    days: Math.floor(minutes / (24 * 60)),
    hours: Math.floor((minutes % (24 * 60)) / 60),
    minutes: minutes % 60,
  };
}

export function WebsiteSessionSettings({ actions }: { actions?: ReactNode }) {
  const intl = useTranslations("components_auth_WebsiteSessionSettings");
  const locale = useLocale() as "zh" | "en";
  const { data: session, isPending, refetch } = useWebsiteSession();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const expiry = session ? formatExpiry(session.session.expiresAt, locale) : null;
  const remaining = useMemo(
    () => session ? remainingParts(session.session.expiresAt, now) : null,
    [now, session],
  );
  const remainingLabel = remaining?.expired
    ? intl("expired")
    : remaining && remaining.days > 0
      ? intl("remainingDaysHours", { days: remaining.days, hours: remaining.hours })
      : remaining
        ? intl("remainingHoursMinutes", { hours: remaining.hours, minutes: remaining.minutes })
        : intl("unavailable");

  async function extendSession() {
    setExtending(true);
    setError(null);
    try {
      const response = await fetch("/api/account/session/extend", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => null) as { data?: { expiresAt?: string }; error?: { message?: string } } | null;
      if (!response.ok || !body?.data?.expiresAt) throw new Error(body?.error?.message ?? intl("extendFailed"));
      await refetch();
      setNow(Date.now());
      setOpen(false);
      reportAccountActivity({ title: locale === "en" ? "Sign-in and security" : "登录与安全", description: intl("extended") });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : intl("extendFailed"));
    } finally {
      setExtending(false);
    }
  }

  return (
    <InfraTechnicalCard group="meeting">
      <section aria-labelledby="settings-session-title" data-settings-group="security">
        <InfraTechnicalHeading icon={<Clock3 className="size-4" aria-hidden="true" />} titleId="settings-session-title">
          {actions ? (locale === "en" ? "Sign-in and security" : "登录与安全") : intl("title")}
        </InfraTechnicalHeading>
        <p className="mt-4 text-sm leading-6 text-white/64">{intl("description")}</p>
        <div className="mt-5 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="grid gap-1">
            <span className="text-sm font-medium text-white">{isPending ? intl("loading") : session ? remainingLabel : intl("signedOut")}</span>
            <span className="text-sm text-white/64">{session && expiry ? intl("expiresAt", { value: expiry }) : intl("signInToManage")}</span>
          </div>
          {session ? (
            <Button type="button" variant="outline" size="dialog" className="w-full border-white/22 bg-white/5 text-white hover:bg-white/10 hover:text-white sm:w-auto" onClick={() => setOpen(true)}>
              <ShieldCheck />{intl("manage")}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="dialog" className="w-full border-white/22 bg-white/5 text-white hover:bg-white/10 hover:text-white sm:w-auto" onClick={event => requestAccountSignIn(event.currentTarget)}>{intl("signIn")}</Button>
          )}
        </div>

        {actions ? <div className="mt-5">{actions}</div> : null}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-[min(460px,calc(100vw-2rem))]">
            <DialogHeader>
              <DialogTitle>{intl("dialogTitle")}</DialogTitle>
              <DialogDescription>{intl("dialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-1">
              <div className="grid gap-1 rounded-md border border-border bg-muted/40 p-4">
                <span className="text-xs text-muted-foreground">{intl("timeRemaining")}</span>
                <strong className="text-xl font-semibold tabular-nums">{remainingLabel}</strong>
                {expiry ? <span className="text-sm text-muted-foreground">{intl("expiresAt", { value: expiry })}</span> : null}
              </div>
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={extending}>{intl("close")}</Button>
              <Button type="button" onClick={() => void extendSession()} disabled={!session || extending}>
                <RefreshCw className={extending ? "animate-spin" : undefined} />
                {extending ? intl("extending") : intl("extendThirtyDays")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </InfraTechnicalCard>
  );
}
