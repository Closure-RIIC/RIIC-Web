import { lazyWithMessages } from "../i18n/features-client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { LoaderCircle } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ACCOUNT_SIGN_IN_EVENT, accountDialogRequest, type AccountSignInDetail } from "@riic/shell/account-sign-in";
import { gameHref } from "@riic/shell/games";
import { Action } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { useAccount } from "../account";
import { DialogFrame } from "./DialogFrame";

const WebsiteAuthContent = lazyWithMessages(() => import("@riic/shell/WebsiteAuthDialog").then(module => ({ default: module.WebsiteAuthContent })), "packages/shell/auth/WebsiteAuthDialog.tsx");

export function AccountDialogHost() {
  const { locale, t, colorMode } = useWorkspace();
  const { pending, session, refresh } = useAccount();
  const router = useRouter();
  const href = useRouterState({ select: state => state.location.href });
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [resetToken, setResetToken] = useState<string>();
  const [origin, setOrigin] = useState<string>();
  const [title, setTitle] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setOrigin(location.origin);
    const show = (event: Event) => {
      returnFocus.current = (event as CustomEvent<AccountSignInDetail>).detail?.trigger ?? document.activeElement as HTMLElement | null;
      setResetToken(undefined);
      setTitle("");
      setMounted(true);
      setOpen(true);
    };
    window.addEventListener(ACCOUNT_SIGN_IN_EVENT, show);
    return () => window.removeEventListener(ACCOUNT_SIGN_IN_EVENT, show);
  }, []);
  useEffect(() => {
    if (pending) return;
    const request = accountDialogRequest(window.location.href);
    if (!request) return;
    router.history.replace(request.cleanHref);
    if (!session || request.resetToken !== undefined) {
      setResetToken(request.resetToken);
      setTitle("");
      setMounted(true);
      setOpen(true);
    }
  }, [href, pending, session, router]);
  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) requestAnimationFrame(() => {
      const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>("[data-sidebar-account-trigger], [data-endfield-mobile-navigation]");
      target?.focus();
      returnFocus.current = null;
    });
  }
  if (!mounted) return null;
  return <Dialog.Root open={open} onOpenChange={changeOpen}><Dialog.Portal>
    <Dialog.Backdrop className="ef-dialog-backdrop" />
    <DialogFrame className="ef-account-dialog" bodyClassName="ef-account-dialog-body" data-website-account-dialog finalFocus={false}
      title={title || (resetToken === undefined ? t("AccountDialogHost.websiteAccountSignIn") : t("AccountDialogHost.resetPassword"))}
      closeLabel={t("AccountDialogHost.close")} footer={null}>
      <Suspense fallback={<p role="status" data-website-account-dialog-loading className="flex min-h-72 items-center justify-center gap-2 px-5 py-8">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        {t("AccountDialogHost.loadingSignIn")}
      </p>}>
        <WebsiteAuthContent locale={locale} active={open} resetToken={resetToken} hideHeading onTitleChange={setTitle}
          renderAction={({ secondary, ...props }) => <Action {...props} size="sm" data-auth-action={secondary ? "secondary" : "primary"}
            variant={secondary ? (colorMode === "dark" ? "dark" : "white") : (colorMode === "dark" ? "white" : "dark")} />}
          legalOrigin={gameHref("arknights", origin, import.meta.env.VITE_ARKNIGHTS_ORIGIN).replace(/\/$/, "")}
          onAuthenticated={async () => {
            const next = await refresh();
            if (!next) throw new Error("SESSION_REFRESH_FAILED");
            changeOpen(false);
          }} />
      </Suspense>
    </DialogFrame>
  </Dialog.Portal></Dialog.Root>;
}
