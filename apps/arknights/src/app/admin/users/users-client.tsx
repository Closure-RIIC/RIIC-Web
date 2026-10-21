"use client";
import { useAdminFetch } from "../admin-context";
import { useTranslations, useLocale } from "use-intl";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, UsersRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AdminSessionData, AdminUserAction, AdminUserData } from "@riic/arknights-domain/types";

const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED === "1";

type RoleChange = { userId: string; name: string; email: string; action: "grantAdmin" | "revokeAdmin" | "grantReviewer" | "revokeReviewer" };

export function AdminUserManagement() {
  const request = useAdminFetch();
  const intl = useTranslations();
  const t = useTranslations("AdminWorkspace");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const [appliedQuery, setAppliedQuery] = useState("");
  const locale = useLocale();
  const en = locale === "en";
  const [users, setUsers] = useState<AdminUserData[]>([]);
  const [verifiedUsers, setVerifiedUsers] = useState<number | null>(null);
  const [canManageAdminRoles, setCanManageAdminRoles] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null);
  const [sessionsByUser, setSessionsByUser] = useState<Record<string, AdminSessionData[] | undefined>>({});

  const load = useCallback(async (search: string) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setVerifiedUsers(null);
    try {
      const response = await request(`/api/admin/users?q=${encodeURIComponent(search)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? (intl("app_admin_users_users_client.couldNotLoadUsers")));
      if (controller.signal.aborted) return;
      setUsers(body.data.users);
      setAppliedQuery(search);
      setPage(1);
      setVerifiedUsers(body.data.summary.verifiedUsers);
      setCanManageAdminRoles(body.data.permissions.canManageAdminRoles);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (loadController.current === controller) {
        loadController.current = null;
        setLoading(false);
      }
    }
  }, [intl, request]);

  useEffect(() => {
    void load("").catch((error) => {
      setMessage(error instanceof Error ? error.message : (intl("app_admin_users_users_client.couldNotLoadUsers")));
    });
    return () => loadController.current?.abort();
  }, [intl, load]);

  async function act(userId: string, action: AdminUserAction): Promise<boolean> {
    if (busyRef.current || loadController.current) return false;
    busyRef.current = true;
    setBusyKey(`${userId}:${action}`);
    setMessage(null);
    try {
      const userPath = `/api/admin/users/${encodeURIComponent(userId)}`;
      const response = action === "revokeSessions"
        ? await request(`${userPath}/sessions`, { method: "DELETE" })
        : await request(userPath, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "ban" || action === "unban"
              ? { banned: action === "ban" }
              : action === "grantReviewer" || action === "revokeReviewer"
                ? { isReviewer: action === "grantReviewer" }
                : { isAdmin: action === "grantAdmin" }),
          });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? (intl("app_admin_users_users_client.actionFailed")));
      setMessage(action === "grantAdmin" ? (intl("app_admin_users_users_client.administratorRoleGranted")) : action === "revokeAdmin" ? (intl("app_admin_users_users_client.administratorRoleRevoked")) : (intl("app_admin_users_users_client.actionCompleted")));
      if (action === "revokeSessions" || action === "ban") {
        setSessionsByUser((current) => ({ ...current, [userId]: [] }));
      }
      await load(appliedQuery);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (intl("app_admin_users_users_client.actionFailed")));
      return false;
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
  }

  async function toggleSessions(userId: string) {
    if (busyRef.current || loadController.current) return;
    if (sessionsByUser[userId]) {
      setSessionsByUser((current) => ({ ...current, [userId]: undefined }));
      return;
    }
    busyRef.current = true;
    setBusyKey(`${userId}:sessions`);
    setMessage(null);
    try {
      const response = await request(`/api/admin/users/${encodeURIComponent(userId)}/sessions`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? (intl("app_admin_users_users_client.couldNotLoadSessions")));
      setSessionsByUser((current) => ({ ...current, [userId]: body.data.sessions }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (intl("app_admin_users_users_client.couldNotLoadSessions")));
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
  }

  const filteredUsers = useMemo(() => users.filter(entry => {
    const roleMatches = roleFilter === "all" || (roleFilter === "admin" ? entry.isAdmin : roleFilter === "reviewer" ? entry.isReviewer : !entry.isAdmin && !entry.isReviewer);
    const statusMatches = statusFilter === "all" || (statusFilter === "suspended" ? entry.banned : statusFilter === "unverified" ? !entry.emailVerified && !entry.banned : entry.emailVerified && !entry.banned);
    return roleMatches && statusMatches;
  }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, locale) : (sort === "oldest" ? 1 : -1) * (Date.parse(a.createdAt) - Date.parse(b.createdAt))), [users, roleFilter, statusFilter, sort, locale]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * 10, currentPage * 10);
  const selectClass = "h-10 max-w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section id="users" className="grid min-w-0 gap-4" data-admin-user-management>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/20 px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-background shadow-sm"><UsersRound className="size-5 text-muted-foreground" aria-hidden="true" /></span>
          <dl data-admin-verified-users aria-busy={loading}>
            <dt className="text-xs text-muted-foreground">{intl("app_admin_users_users_client.verifiedUsers")}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums" aria-live="polite">{verifiedUsers === null ? "—" : new Intl.NumberFormat(locale).format(verifiedUsers)}</dd>
            <dd className="text-xs text-muted-foreground">{intl("app_admin_users_users_client.verifiedUsersScope")}</dd>
          </dl>
        </div>
        <p className="max-w-md text-xs leading-5 text-muted-foreground">{canManageAdminRoles === true ? intl("app_admin_users_users_client.theBootstrapAdministratorCanAlsoChangeAdministratorRoles") : canManageAdminRoles === false ? intl("app_admin_users_users_client.administratorRolesCanBeChangedOnlyByTheBootstrap") : ""}</p>
      </div>
      <form className="flex flex-wrap gap-2" role="search" onSubmit={event => {
        event.preventDefault();
        if (busyRef.current) return;
        setMessage(null);
        setExpandedUser(null);
        void load(query.trim()).catch(error => setMessage(error instanceof Error ? error.message : intl("app_admin_users_users_client.couldNotLoadUsers")));
      }}>
        <div className="relative min-w-0 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="h-10 pl-9" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} placeholder={intl("app_admin_users_users_client.searchByEmailOrName")} aria-label={intl("app_admin_users_users_client.searchByEmailOrName")} /></div>
        <Button type="submit" variant="outline" disabled={loading || Boolean(busyKey)} className="h-10">{intl("app_admin_users_users_client.search")}</Button>
        <select className={selectClass} aria-label={t("role")} value={roleFilter} onChange={event => { setRoleFilter(event.target.value); setPage(1); }}>
          <option value="all">{t("allRoles")}</option><option value="admin">{t("administrator")}</option><option value="reviewer">{t("reviewer")}</option><option value="user">{t("regularUser")}</option>
        </select>
        <select className={selectClass} aria-label={t("status")} value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}>
          <option value="all">{t("allStatuses")}</option><option value="active">{t("active")}</option><option value="suspended">{t("suspended")}</option><option value="unverified">{t("unverified")}</option>
        </select>
        <select className={selectClass} aria-label={t("sort")} value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
          <option value="newest">{t("newest")}</option><option value="oldest">{t("oldest")}</option><option value="name">{t("nameOrder")}</option>
        </select>
      </form>
      {message && <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">{message}</p>}
      <p className="text-xs text-muted-foreground">{t("filterScope", { count: users.length })}</p>
      <div className="min-w-0 overflow-x-auto rounded-xl border" data-yeye-scroll="auto">
        <table className="w-full min-w-[720px] text-left text-sm" aria-label={t("users")} aria-busy={loading}>
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{(["account", "role", "status", "createdAt", "actions"] as const).map(key => <th key={key} scope="col" className="px-4 py-3 font-medium last:text-right">{t(key)}</th>)}</tr></thead>
          <tbody>
            {loading ? Array.from({ length: 5 }, (_, index) => <tr key={index} className="border-t"><td colSpan={5} className="px-4 py-4"><Skeleton className="h-8 w-full" /></td></tr>) : visibleUsers.map(entry => {
              const sessions = sessionsByUser[entry.id];
              const actionBusy = loading || Boolean(busyKey);
              const expanded = expandedUser === entry.id;
              return <Fragment key={entry.id}>
                <tr className="border-t hover:bg-muted/30">
                  <td className="max-w-80 px-4 py-3"><div className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium" aria-hidden="true">{entry.name.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate font-medium">{entry.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{entry.email}</span></span></div></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{entry.isAdmin && <span className="rounded-md border px-2 py-1 text-xs">{intl(entry.isBootstrapAdmin ? "app_admin_users_users_client.bootstrapAdmin" : "app_admin_users_users_client.admin")}</span>}{entry.isReviewer && <span className="rounded-md border px-2 py-1 text-xs">{t("reviewer")}</span>}{!entry.isAdmin && !entry.isReviewer && <span className="text-muted-foreground">{t("regularUser")}</span>}</div></td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs ${entry.banned ? "bg-destructive/10 text-destructive" : !entry.emailVerified ? "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"}`}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{t(entry.banned ? "suspended" : !entry.emailVerified ? "unverified" : "active")}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(entry.createdAt))}</td>
                  <td className="px-4 py-3 text-right"><Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls={`user-detail-${entry.id}`} onClick={() => setExpandedUser(expanded ? null : entry.id)}>{t(expanded ? "closeDetails" : "details")}<ChevronDown className={expanded ? "rotate-180" : ""} aria-hidden="true" /></Button></td>
                </tr>
                {expanded && <tr className="border-t bg-muted/15"><td colSpan={5} className="p-4"><div id={`user-detail-${entry.id}`} className="grid gap-4" aria-label={entry.name}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="break-all">{entry.email}</span><span>· {t(entry.emailVerified ? "verified" : "unverified")}</span>
                    {CLIENT_SKLAND_ENABLED && <span>{entry.sklandActiveBindingCount > 0 ? intl("app_admin_users_users_client.sklandActive", { sklandActiveBindingCount: entry.sklandActiveBindingCount }) : intl("app_admin_users_users_client.noActiveSklandAuthorization")}</span>}
                    {CLIENT_SKLAND_ENABLED && entry.sklandRenewalDueCount > 0 && <span className="text-amber-700">{intl("app_admin_users_users_client.renewalDue")} · {entry.sklandRenewalDueCount}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-user-billing-summary>
                    <span className="font-medium text-foreground">{en ? "Points" : "积分"} {entry.totalPoints}</span>
                    <span>{en ? "Permanent" : "永久"} {entry.paidPoints}</span>
                    <span>{en ? "Monthly" : "月卡"} {entry.monthlyPoints}{entry.monthlyExpiresAt ? ` · ${en ? "expires" : "到期"} ${new Date(entry.monthlyExpiresAt).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN")}` : ""}</span>
                  </div>
                  {entry.banned && entry.banReason && <p className="text-xs text-destructive">{entry.banReason}</p>}
                  <div className="flex flex-wrap gap-2">
                    {canManageAdminRoles && !entry.isBootstrapAdmin ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={entry.isAdmin ? "destructive" : "secondary"}
                        disabled={actionBusy || (!entry.isAdmin && (!entry.emailVerified || Boolean(entry.banned)))}
                        title={!entry.isAdmin && (!entry.emailVerified || entry.banned) ? (intl("app_admin_users_users_client.onlyVerifiedActiveAccountsCanBecomeAdministrators")) : undefined}
                        onClick={() => setRoleChange({ userId: entry.id, name: entry.name, email: entry.email, action: entry.isAdmin ? "revokeAdmin" : "grantAdmin" })}
                      >
                        {entry.isAdmin ? (intl("app_admin_users_users_client.revokeAdmin")) : (intl("app_admin_users_users_client.grantAdmin"))}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" disabled={actionBusy} onClick={() => void toggleSessions(entry.id)}>{sessions ? (intl("app_admin_users_users_client.hideSessions")) : (intl("app_admin_users_users_client.viewSessions"))}</Button>
                    {canManageAdminRoles && !entry.isBootstrapAdmin ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={entry.isReviewer ? "destructive" : "secondary"}
                        disabled={actionBusy || (!entry.isReviewer && (!entry.emailVerified || Boolean(entry.banned)))}
                        title={!entry.isReviewer && (!entry.emailVerified || entry.banned) ? intl("adminReviewer.eligible") : undefined}
                        onClick={() => setRoleChange({ userId: entry.id, name: entry.name, email: entry.email, action: entry.isReviewer ? "revokeReviewer" : "grantReviewer" })}
                      >
                        {intl(entry.isReviewer ? "adminReviewer.revoke" : "adminReviewer.grant")}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" disabled={actionBusy} onClick={() => void act(entry.id, "revokeSessions")}>{intl("app_admin_users_users_client.revokeSessions")}</Button>
                    <Button type="button" size="sm" variant={entry.banned ? "outline" : "destructive"} disabled={actionBusy} onClick={() => void act(entry.id, entry.banned ? "unban" : "ban")}>{entry.banned ? (intl("app_admin_users_users_client.unsuspend")) : (intl("app_admin_users_users_client.suspend"))}</Button>
                  </div>
                {sessions ? (
                  <div className="mt-4 grid gap-2 border-t pt-3">
                    {sessions.length ? sessions.map((current) => (
                      <div key={current.id} className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                        <p>{intl("app_admin_users_users_client.created")}{new Date(current.createdAt).toLocaleString((locale === "en" ? "en-US" : "zh-CN"))} · {intl("app_admin_users_users_client.expires")}{new Date(current.expiresAt).toLocaleString((locale === "en" ? "en-US" : "zh-CN"))}</p>
                        <p className="mt-1 break-all">{current.ipAddress ?? (intl("app_admin_users_users_client.unknownIp"))} · {current.userAgent ?? (intl("app_admin_users_users_client.unknownBrowser"))}</p>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">{intl("app_admin_users_users_client.noActiveSessions")}</p>}
                  </div>
                ) : null}

                </div></td></tr>}
              </Fragment>;
            })}
            {!loading && !visibleUsers.length && <tr className="border-t"><td colSpan={5} className="px-4 py-12 text-center"><UsersRound className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{t("noResults")}</p><p className="mt-1 text-xs text-muted-foreground">{t("noResultsHint")}</p><Button type="button" variant="ghost" className="mt-3" onClick={() => { setRoleFilter("all"); setStatusFilter("all"); setPage(1); }}>{t("resetFilters")}</Button></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status">{loading ? intl("app_admin_users_users_client.loadingUsers") : t("resultCount", { count: filteredUsers.length })}</span>
        <div className="flex items-center gap-3"><span>{t("page", { page: currentPage, total: pageCount })}</span><Button variant="outline" size="icon" aria-label={t("previous")} disabled={loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft aria-hidden="true" /></Button><Button variant="outline" size="icon" aria-label={t("next")} disabled={loading || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight aria-hidden="true" /></Button></div>
      </div>

      <Dialog
        open={Boolean(roleChange)}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setRoleChange(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{roleChange?.action === "grantReviewer" || roleChange?.action === "revokeReviewer" ? intl(roleChange.action === "grantReviewer" ? "adminReviewer.grant" : "adminReviewer.revoke") : roleChange?.action === "revokeAdmin" ? (intl("app_admin_users_users_client.revokeAdministratorRole")) : (intl("app_admin_users_users_client.grantAdministratorRole"))}</DialogTitle>
            <DialogDescription className="break-words">
              {roleChange?.action === "grantReviewer" || roleChange?.action === "revokeReviewer"
                ? intl(roleChange.action === "grantReviewer" ? "adminReviewer.grantDescription" : "adminReviewer.revokeDescription", { name: roleChange.name, email: roleChange.email })
                : roleChange?.action === "revokeAdmin"
                ? (intl("app_admin_users_users_client.willImmediatelyLoseAccessToUserManagement", { name: roleChange.name, email: roleChange.email }))
                : (intl("app_admin_users_users_client.willBeAbleToSearchAndSuspendUsersAnd", { value1: (en) ? (roleChange?.name ?? "This user") : "", value2: roleChange?.email ?? "", value3: (en) ? "" : (roleChange?.name ?? "该用户") }))}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">{intl("app_admin_users_users_client.thisActionDoesNotChangeTheAccountPasswordOr")}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" size="dialog" variant="ghost" disabled={Boolean(busyKey)} onClick={() => setRoleChange(null)}>{intl("app_admin_users_users_client.cancel")}</Button>
            <Button
              type="button"
              size="dialog"
              variant={roleChange?.action === "revokeAdmin" || roleChange?.action === "revokeReviewer" ? "destructive" : "default"}
              disabled={!roleChange || Boolean(busyKey)}
              onClick={async () => {
                if (!roleChange) return;
                if (await act(roleChange.userId, roleChange.action)) setRoleChange(null);
              }}
            >
              {roleChange?.action === "grantReviewer" ? intl("adminReviewer.confirm") : roleChange?.action === "revokeAdmin" || roleChange?.action === "revokeReviewer" ? (intl("app_admin_users_users_client.confirmRevocation")) : (intl("app_admin_users_users_client.confirmAdministrator"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
