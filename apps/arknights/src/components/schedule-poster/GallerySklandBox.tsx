import { Suspense, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { WebsiteAuthContent } from "@riic/shell/WebsiteAuthDialog";
import { getSklandAccounts, selectSklandRole } from "@/api";
import { useWorkbench } from "@/workbench-context";
import { useWebsiteSession } from "@/website-session";
import { lazyWithMessages } from "@/i18n/features-client";
import { Button } from "@/components/ui/button";
import { SklandAccountSelect } from "@/components/skland/SklandAccountSelect";
import { assertOperbox } from "@riic/arknights-domain/operbox";
import type { SklandSessionData } from "@riic/arknights-domain/types";
import type { ComparisonBoxFile } from "./GalleryBoxPicker";

const LoginPanel = lazyWithMessages(() => import("@/skland-components").then(module => ({ default: module.SklandLoginPanel })), "apps/arknights/src/skland-components.tsx");

export default function GallerySklandBox({ onSelect }: { onSelect: (box: ComparisonBoxFile) => void }) {
  const t = useTranslations("ScheduleGallery");
  const locale = useLocale();
  const { account, skland } = useWorkbench();
  const { data, refetch } = useWebsiteSession();
  const identity = data?.user.id ?? "";
  const [loaded, setLoaded] = useState<{ identity: string; session: SklandSessionData } | null>(null);
  const session = loaded?.identity === identity ? loaded.session : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanNew, setScanNew] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef({ revision: 0 });
  useEffect(() => {
    const tracker = generation.current;
    const current = ++tracker.revision;
    if (!account.authenticated) return;
    setLoading(true); setError("");
    void getSklandAccounts().then(next => {
      if (generation.current.revision === current) setLoaded({ identity, session: next });
    }).catch(() => { if (generation.current.revision === current) setError(t("sklandBoxLoadFailed")); })
      .finally(() => { if (generation.current.revision === current) setLoading(false); });
    return () => { tracker.revision++; };
  }, [account.authenticated, identity, revision, t]);

  function selectSessionBox(next: SklandSessionData) {
    try {
      const entries = assertOperbox(next.scheduleSnapshot?.operbox);
      if (entries.length > 1000) throw new Error("Invalid roster size");
      onSelect({ entries, name: next.scheduleSnapshot?.sourceName || t("sklandBoxName") });
    } catch { setError(t("sklandBoxMissing")); }
  }
  async function changeRole(accountId: string, uid: string) {
    const current = ++generation.current.revision;
    setLoading(true); setError("");
    try {
      const next = await selectSklandRole(accountId, uid);
      if (current === generation.current.revision) setLoaded({ identity, session: next });
    } catch { if (current === generation.current.revision) setError(t("sklandBoxLoadFailed")); }
    finally { if (current === generation.current.revision) setLoading(false); }
  }
  if (account.pending) return <p role="status" className="py-6 text-sm text-muted-foreground">{t("loadingAccount")}</p>;
  if (!account.authenticated) return <div className="space-y-4" data-gallery-website-login><p className="text-sm text-muted-foreground">{t("websiteLoginFirst")}</p><WebsiteAuthContent locale={locale} active onAuthenticated={async () => { if (account.onSessionChanged) await account.onSessionChanged(true); else await refetch(); }} /></div>;
  if (loading) return <p role="status" className="py-6 text-sm text-muted-foreground">{t("loadingSklandBox")}</p>;
  const configured = session?.configured ?? skland?.skland.configured ?? false;
  const activeAccount = session?.accounts.find(item => item.accountId === session.activeAccountId);
  return <div className="min-w-0 space-y-4" data-gallery-skland-box>
    <p className="text-xs leading-5 text-muted-foreground">{t("scanBoxHint")}</p>
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t("refresh")}</Button></div>}
    {session?.authenticated && session.scheduleSnapshot && !scanNew ? <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">{t("connectedSklandBox")}</p>
      <SklandAccountSelect accounts={session.accounts} accountId={session.activeAccountId} uid={activeAccount?.selectedUid ?? ""} disabled={loading} onRoleChange={(id, uid) => void changeRole(id, uid)} />
      <div className="flex flex-wrap gap-2"><Button onClick={() => selectSessionBox(session)}>{t("useSklandBox")}</Button><Button variant="outline" onClick={() => setScanNew(true)}>{t("scanAnotherBox")}</Button></div>
    </div> : <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{t("loadingSklandBox")}</p>}><LoginPanel configured={configured} disabledReason={session?.disabledReason ?? skland?.skland.disabledReason} dialogPresentation onAuthenticated={next => { setLoaded({ identity, session: next }); selectSessionBox(next); }} /></Suspense>}
  </div>;
}
