"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_auth_WebsiteAccountDialogLoading.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_auth_WebsiteAccountDialogLoading");

import { useLocale, useTranslations } from "use-intl";

import { LoaderCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WebsiteAccountDialogLoadingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const websiteAuthDialogClassName = "!flex flex-col !top-[var(--auth-viewport-center,50%)] max-h-[calc(var(--auth-viewport-height,100dvh)-24px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] !w-[min(460px,calc(100vw-24px))] !max-w-[min(460px,calc(100vw-24px))] min-w-0 overflow-hidden";

export function WebsiteAccountLoadingStatus() {
  const intl = useTranslations();

  return (
    <div
      className="grid min-h-72 place-items-center px-6 py-12 text-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-website-account-loading
    >
      <div className="grid justify-items-center gap-3">
        <LoaderCircle
          className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
          data-website-account-loading-spinner
        />
        <p className="text-sm text-muted-foreground">{intl("components_auth_WebsiteAccountDialogLoading.loadingSignIn")}</p>
      </div>
    </div>
  );
}

export function WebsiteAccountDialogLoading({
  open,
  onOpenChange,
}: WebsiteAccountDialogLoadingProps) {
  const intl = useTranslations();
  const locale = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-website-account-dialog
        data-website-account-dialog-loading
        aria-busy="true"
        finalFocus={false}
        closeLabel={uiText.text(locale, "close")}
        className={websiteAuthDialogClassName}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{intl("components_auth_WebsiteAccountDialogLoading.websiteAccountSignIn")}</DialogTitle>
          <DialogDescription>{intl("components_auth_WebsiteAccountDialogLoading.theSignInInterfaceIsLoading")}</DialogDescription>
        </DialogHeader>
        <div className="relative z-[1] mx-auto min-w-0 max-w-full">
          <WebsiteAccountLoadingStatus />
        </div>
      </DialogContent>
    </Dialog>
  );
}
