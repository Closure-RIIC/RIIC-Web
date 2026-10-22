"use client";
import { useTranslations } from "use-intl";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-website-account-dialog
        data-website-account-dialog-loading
        aria-busy="true"
        finalFocus={false}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] min-w-0 overflow-x-hidden overflow-y-auto max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:!w-screen max-md:!max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:!rounded-none md:!top-1/2 md:!left-1/2 md:!-translate-x-1/2 md:!-translate-y-1/2 md:w-full md:max-w-[min(880px,calc(100vw-2rem))]"
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
