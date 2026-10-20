"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";
import { usePathname, useRouter } from "@/navigation";
import { FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminShell } from "../admin/admin-shell";
import { AdminDataProvider } from "../admin/admin-context";
import { createAdminPreviewRequest } from "./preview-data";

const PreviewRole = createContext(true);
export function usePreviewAdmin() { return useContext(PreviewRole); }

export function AdminPreview({ children }: { children: ReactNode }) {
  const t = useTranslations("AdminWorkspace");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(true);
  const [generation, setGeneration] = useState(0);
  const request = useMemo(() => {
    // Resetting the preview replaces the complete in-memory data store.
    void generation;
    return createAdminPreviewRequest(isAdmin, locale === "en");
  }, [isAdmin, locale, generation]);
  return <PreviewRole.Provider value={isAdmin}>
    <AdminDataProvider request={request} basePath="/admin-preview">
      <AdminShell isAdmin={isAdmin} name={locale === "en" ? "RIIC preview" : "罗德岛 · 演示账户"} basePath="/admin-preview">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/60 bg-amber-50/60 px-4 py-3 text-amber-950 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-start gap-2"><FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><div><p className="text-xs font-semibold">{t("preview")}</p><p className="mt-1 text-xs leading-5">{t("previewHint")}</p></div></div>
          <div className="flex items-center gap-2">
            <select className="h-9 rounded-lg border border-amber-200 bg-background px-2 text-xs text-foreground" aria-label={t("previewRole")} value={isAdmin ? "admin" : "reviewer"} onChange={event => {
              const admin = event.target.value === "admin";
              setIsAdmin(admin);
              if (!admin && ["/users", "/skills", "/changelog"].some(path => pathname.endsWith(path))) router.push("/admin-preview");
            }}><option value="admin">{t("administrator")}</option><option value="reviewer">{t("reviewer")}</option></select>
            <Button variant="ghost" size="icon" aria-label={t("previewReset")} onClick={() => setGeneration(value => value + 1)}><RotateCcw aria-hidden="true" /></Button>
          </div>
        </div>
        <div key={`${isAdmin}-${generation}`} className="min-w-0">{children}</div>
      </AdminShell>
    </AdminDataProvider>
  </PreviewRole.Provider>;
}
