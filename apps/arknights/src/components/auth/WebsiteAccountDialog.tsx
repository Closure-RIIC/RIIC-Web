"use client";
import { useTranslations } from "use-intl";

import { WebsiteAccountPanel } from "@/components/auth/WebsiteAccountPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WebsiteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionChanged: (authenticated: boolean) => void | Promise<void>;
}

export function WebsiteAccountDialog({
  open,
  onOpenChange,
  onSessionChanged,
}: WebsiteAccountDialogProps) {
  const intl = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-website-account-dialog
        finalFocus={false}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] min-w-0 overflow-x-hidden overflow-y-auto max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:!w-screen max-md:!max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:!rounded-none md:!top-1/2 md:!left-1/2 md:!-translate-x-1/2 md:!-translate-y-1/2 md:w-full md:max-w-[min(880px,calc(100vw-2rem))]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{intl("components_auth_WebsiteAccountDialog.websiteAccountSignIn")}</DialogTitle>
          <DialogDescription>{intl("components_auth_WebsiteAccountDialog.signInToManageYourWebsiteAccount")}</DialogDescription>
        </DialogHeader>
        <div className="relative z-[1] mx-auto min-w-0 max-w-full">
          <WebsiteAccountPanel loadingMode="dialog" onSessionChanged={onSessionChanged} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
