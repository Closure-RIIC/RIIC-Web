"use client";
import { useTranslations } from "use-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function SetupDialogSkeleton({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const intl = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-setup-dialog
        data-setup-dialog-skeleton
        aria-busy="true"
        className="h-[min(720px,calc(100dvh-1rem))] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[min(960px,calc(100%-2rem))] sm:rounded-[32px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{intl("components_setup_SetupDialogSkeleton.scheduleSettings")}</DialogTitle>
          <DialogDescription>{intl("components_setup_SetupDialogSkeleton.scheduleSettingsAreLoading")}</DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-3 pt-4 sm:px-7 sm:pb-4 sm:pt-6">
          <Skeleton className="h-6 w-24" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
        <div className="min-h-0 border-y border-border/70 px-4 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-36 w-full rounded-none" />
            </div>
            <div className="grid content-start gap-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-20 w-full rounded-none" />
              <Skeleton className="h-20 w-full rounded-none" />
            </div>
          </div>
        </div>
        <footer className="flex w-full min-w-0 flex-nowrap items-center justify-end gap-1.5 px-4 pb-4 pt-2 sm:gap-2 sm:px-7 sm:pb-7 sm:pt-3">
          <Skeleton className="h-[46px] w-20" />
          <Skeleton className="h-[46px] w-24" />
        </footer>
      </DialogContent>
    </Dialog>
  );
}
