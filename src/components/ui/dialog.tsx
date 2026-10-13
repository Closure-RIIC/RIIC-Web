"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { useRender } from "@base-ui/react/use-render"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { dialogAccentForPathname } from "@/workbench-accent"
import { XIcon } from "lucide-react"

const DialogExitActions = React.createContext<React.RefObject<DialogPrimitive.Root.Actions | null> | null>(null)

function Dialog({ actionsRef, ...props }: DialogPrimitive.Root.Props) {
  const exitActions = React.useRef<DialogPrimitive.Root.Actions | null>(null)
  return (
    <DialogExitActions value={actionsRef ? null : exitActions}>
      <DialogPrimitive.Root data-slot="dialog" actionsRef={actionsRef ?? exitActions} {...props} />
    </DialogExitActions>
  )
}

function DialogPopupElement({ open, ref, ...props }: React.ComponentPropsWithRef<"div"> & { open: boolean }) {
  const popupRef = React.useRef<HTMLDivElement | null>(null)
  const exitActions = React.useContext(DialogExitActions)
  React.useEffect(() => {
    const popup = popupRef.current
    // Explicit actionsRef callers own their external animation lifecycle.
    if (open || !popup || !exitActions) return
    let active = true
    let frame = 0
    function finishExit() {
      if (!active || !popup?.isConnected || !popup.hasAttribute("data-closed")) return
      const animations = popup.getAnimations().filter((animation) => animation.pending || animation.playState === "running")
      if (animations.length) {
        // Base UI 1.6 may not complete a close if every awaited animation was
        // cancelled. Wait for replacements too, without a fixed unmount timer.
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
          if (active) frame = requestAnimationFrame(finishExit)
        })
      } else {
        exitActions?.current?.unmount()
      }
    }
    frame = requestAnimationFrame(finishExit)
    return () => { active = false; cancelAnimationFrame(frame) }
  }, [open, exitActions])
  return useRender({ defaultTagName: "div", ref: ref ? [ref, popupRef] : popupRef, props })
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  layer = "base",
  ...props
}: DialogPrimitive.Backdrop.Props & {
  layer?: "base" | "nested"
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      data-dialog-layer={layer}
      className={cn(
        "dialog-overlay fixed inset-0 isolate z-50",
        layer === "nested"
          ? "bg-black/[0.08]"
          : "bg-black/20",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  layer = "base",
  fromSkeleton = false,
  style,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  layer?: "base" | "nested"
  fromSkeleton?: boolean
}) {
  const pathname = usePathname()
  const accentStyle = { "--dialog-accent": dialogAccentForPathname(pathname) }
  return (
    <DialogPortal>
      <DialogOverlay layer={layer} />
      <DialogPrimitive.Popup
        render={(popupProps, state) => <DialogPopupElement {...popupProps} open={state.open} />}
        data-yeye-scroll="auto"
        data-slot="dialog-content"
        data-dialog-layer={layer}
        data-from-skeleton={fromSkeleton || undefined}
        style={typeof style === "function"
          ? (state) => ({ ...accentStyle, ...style(state) })
          : { ...accentStyle, ...style }}
        className={cn(
          // OverlayScrollbars applies unlayered position: relative to scroll hosts.
          // A popup must keep its viewport positioning after enhancement.
          "dialog-surface dialog-popup !fixed top-1/2 left-1/2 z-50 isolate grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-[24px] p-0 text-sm text-popover-foreground outline-none sm:max-w-[min(480px,calc(100vw-2rem))] sm:rounded-[32px]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="pointer-events-auto absolute top-3 right-3 z-20 size-10 rounded-[4px] bg-transparent hover:bg-transparent"
                size="icon"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("relative z-[1] flex flex-col gap-2 px-5 pb-3 pt-5 pr-14 sm:px-7 sm:pb-4 sm:pt-6 sm:pr-16", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      data-yeye-scroll="auto"
      className={cn("relative z-[1] grid gap-4 px-5 py-3 sm:px-7", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "relative z-[1] flex flex-row items-center justify-end gap-2 px-5 pb-5 pt-3 sm:px-7 sm:pb-6 sm:pt-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button size="dialog" variant="ghost" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, children, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "flex min-h-8 items-center gap-3 font-heading text-lg font-semibold leading-tight",
        className
      )}
      {...props}
    >
      <span className="h-6 w-1 shrink-0 bg-[var(--dialog-accent,var(--primary))]" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </DialogPrimitive.Title>
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[13px] leading-5 text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
