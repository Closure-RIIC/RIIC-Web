"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../messages/zh-CN/Shell_auth_WebsiteAuthDialog.json";
const uiText = createUiLocalizer<typeof UiMessages>("Shell_auth_WebsiteAuthDialog");


import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { IntlProvider, useLocale, useTranslations } from "use-intl";
import { WebsiteAuthForm, type AuthMode } from "./WebsiteAuthForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { getCatalog } from "@riic/arknights-domain/i18n/localize";
import { resolveLocale } from "@riic/contracts/locale";
import styles from "./WebsiteAuthDialog.module.css";
import formStyles from "./AuthForm.module.css";
import { AuthActionContext, type AuthActionRenderer } from "./AuthAction";

export function WebsiteAuthDialog({ locale, ...props }: {
  locale: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: () => void | Promise<void>;
  legalOrigin?: string;
  resetToken?: string;
  finalFocus?: false | RefObject<HTMLElement | null>;
}) {
  const language = resolveLocale(locale);
  return <IntlProvider locale={language} messages={{ Account: getCatalog(language, "Account") }} timeZone="Asia/Shanghai">
    <AccountDialog {...props} />
  </IntlProvider>;
}

function AccountDialog({ open, onOpenChange, onAuthenticated, legalOrigin, resetToken, finalFocus }: Omit<Parameters<typeof WebsiteAuthDialog>[0], "locale">) {
  const intl = useTranslations("Account");
  const locale = useLocale();
  const [title, setTitle] = useState("");
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className={styles.backdrop} data-slot="dialog-overlay" />
      <Dialog.Popup className={styles.popup} data-website-account-dialog data-slot="dialog-content" finalFocus={finalFocus}>
        <Dialog.Title className="sr-only">{title || intl(resetToken === undefined ? "components_auth_WebsiteAccountDialog.websiteAccountSignIn" : "app_account_reset_password_reset_client.resetPassword")}</Dialog.Title>
        <Dialog.Description className="sr-only">{intl("components_auth_WebsiteAccountDialog.signInToManageYourWebsiteAccount")}</Dialog.Description>
        <Dialog.Close className={styles.close} aria-label={uiText.text(locale, "close")}><X aria-hidden="true" /></Dialog.Close>
        <DialogForm key={resetToken ?? "signin"} active={open} resetToken={resetToken} onAuthenticated={onAuthenticated} legalOrigin={legalOrigin} onTitleChange={setTitle} />
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

type AuthContentProps = {
  resetToken?: string;
  onAuthenticated: () => void | Promise<void>;
  legalOrigin?: string;
  active?: boolean;
  hideHeading?: boolean;
  onTitleChange?: (title: string) => void;
};

export function WebsiteAuthContent({ locale, renderAction, ...props }: { locale: string; renderAction?: AuthActionRenderer } & AuthContentProps) {
  const language = resolveLocale(locale);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.active === false) return;
    const popup = content.current?.closest<HTMLElement>('[role="dialog"]');
    const viewport = window.visualViewport;
    if (!popup || !viewport) return;
    const resize = () => {
      popup.style.setProperty("--auth-viewport-height", `${viewport.height}px`);
      popup.style.setProperty("--auth-viewport-center", `${viewport.offsetTop + viewport.height / 2}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      popup.style.removeProperty("--auth-viewport-height");
      popup.style.removeProperty("--auth-viewport-center");
    };
  }, [props.active]);
  return <IntlProvider locale={language} messages={{ Account: getCatalog(language, "Account") }} timeZone="Asia/Shanghai">
    <AuthActionContext value={renderAction}>
      <div ref={content} className={formStyles.panel}><DialogForm key={props.resetToken ?? "signin"} {...props} /></div>
    </AuthActionContext>
  </IntlProvider>;
}

function DialogForm({ resetToken, ...props }: AuthContentProps) {
  const [mode, setMode] = useState<AuthMode | "reset">(resetToken !== undefined ? "reset" : "signin");
  return mode === "reset"
    ? <ResetPasswordForm {...props} token={resetToken ?? ""} onSignIn={() => setMode("signin")} onForgotPassword={() => setMode("forgot")} />
    : <WebsiteAuthForm {...props} key={mode} initialMode={mode} />;
}
