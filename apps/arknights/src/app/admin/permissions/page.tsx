"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { useAdminRequest } from "../admin-context";
import { adminPageClass, AdminPageHeader } from "../admin-page";
import { AdminUserManagement } from "../users/users-client";

type SuperAdmin = { id: string; name: string | null; email: string | null; banned: boolean | null; exists: boolean };

export function AdminPermissionsPage() {
  const t = useTranslations("AdminPermissions");
  const request = useAdminRequest();
  const [accounts, setAccounts] = useState<SuperAdmin[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const data = await request<{ superAdmins: SuperAdmin[] }>("/api/admin/permissions", { cache: "no-store", signal });
      if (!signal.aborted) setAccounts(data.superAdmins);
    } catch (cause) {
      if (!signal.aborted) { setAccounts([]); setError(cause instanceof Error ? cause.message : String(cause)); }
    } finally { if (!signal.aborted) setLoading(false); }
  }, [request]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);

  return <main id="admin-content" className={adminPageClass}>
    <AdminPageHeader title="permissions" description="permissionsHint" />
    <section className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-5" aria-labelledby="super-admin-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="super-admin-list" className="text-lg font-semibold">{t("serverList")}</h2>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t("refresh")}</Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{t("serverListHint")}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t("serverListChange")}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : !error && <ul className="grid gap-3 sm:grid-cols-2">
        {accounts.map(account => <li key={account.id} className="min-w-0 space-y-1 rounded-lg bg-muted/40 p-3">
          <p className="break-words font-medium">{account.name ?? t("missingAccount")}</p>
          {account.email && <p className="break-all text-sm text-muted-foreground">{account.email}</p>}
          <p className="break-all font-mono text-xs text-muted-foreground">{t("accountId")}: {account.id}</p>
          <p className="text-xs">{!account.exists ? t("missingAccountHint") : account.banned ? t("banned") : t("serverManaged")}</p>
        </li>)}
      </ul>}
    </section>
    <section className="min-w-0 space-y-4" aria-labelledby="backend-roles">
      <h2 id="backend-roles" className="text-lg font-semibold">{t("backendRoles")}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{t("backendRolesHint")}</p>
      <AdminUserManagement rolesOnly />
    </section>
  </main>;
}
