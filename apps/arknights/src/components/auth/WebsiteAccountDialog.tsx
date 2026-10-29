"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_auth_WebsiteAccountDialog.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_auth_WebsiteAccountDialog");

import { useLocale, useTranslations } from "use-intl";
import { useState } from "react";
import { WebsiteAuthContent } from "@riic/shell/WebsiteAuthDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { websiteAuthDialogClassName } from "./WebsiteAccountDialogLoading";

export function WebsiteAccountDialog({ open, onOpenChange, onSessionChanged, resetToken }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionChanged: (authenticated: boolean) => void | Promise<void>;
  resetToken?: string;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const [title, setTitle] = useState("");
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-website-account-dialog finalFocus={false} closeLabel={uiText.text(locale, "close")}
      className={websiteAuthDialogClassName}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title || intl(resetToken === undefined ? "components_auth_WebsiteAccountDialog.websiteAccountSignIn" : "app_account_reset_password_reset_client.resetPassword")}</DialogTitle>
        <DialogDescription>{intl("components_auth_WebsiteAccountDialog.signInToManageYourWebsiteAccount")}</DialogDescription>
      </DialogHeader>
      <div className="relative z-[1] flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <WebsiteAuthContent locale={locale} active={open} onAuthenticated={() => onSessionChanged(true)} resetToken={resetToken} onTitleChange={setTitle} />
      </div>
    </DialogContent>
  </Dialog>;
}
