"use client";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { motion, type HTMLMotionProps, useReducedMotion } from "motion/react";
import { Check, CircleHelp, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { usePathname } from "@/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";

const helpLinks = [
  { href: "/help", content: "components_help_HelpFloatingNav_content" as const },
  { href: "/help/import-operators", content: "components_help_HelpFloatingNav_content2" as const },
  { href: "/help/owned-operators", content: "components_help_HelpFloatingNav_content3" as const },
];

export function HelpFloatingNav() {
  const intl = useTranslations();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const locale = useLocale();
  const en = locale;
  const open = openPath === pathname;

  return (
    <PopoverPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => setOpenPath(nextOpen ? pathname : null)}
    >
      <PopoverPrimitive.Trigger
        data-help-floating-trigger
        render={
          <Button
            aria-label={intl("components_help_HelpFloatingNav.helpMenu")}
            className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 size-12 rounded-full border border-background/20 shadow-xl shadow-foreground/20 ring-4 ring-background/75 transition-transform duration-200 hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none print:hidden"
            size="icon"
          />
        }
      >
        <CircleHelp className="size-5" aria-hidden="true" />
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          align="end"
          collisionPadding={16}
          positionMethod="fixed"
          side="top"
          sideOffset={12}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup data-yeye-scroll="auto"
            data-help-floating-panel
            render={(renderProps, state) => (
              <motion.div
                {...(renderProps as unknown as HTMLMotionProps<"div">)}
                initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.98, y: reduceMotion ? 0 : 8 }}
                animate={{
                  opacity: state.open ? 1 : 0,
                  scale: state.open || reduceMotion ? 1 : 0.98,
                  y: state.open || reduceMotion ? 0 : 6,
                }}
                transition={{
                  duration: reduceMotion ? 0 : state.open ? MOTION_DURATION.state : MOTION_DURATION.fast,
                  ease: MOTION_EASE_OUT,
                }}
                style={{ ...(renderProps.style ?? {}), transformOrigin: "var(--transform-origin)" }}
              />
            )}
            className="max-h-[min(28rem,calc(100dvh-6rem))] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-[4px] border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
          >
            <div className="flex items-start justify-between gap-3 px-3 pb-2 pt-1">
              <div>
                <PopoverPrimitive.Title className="text-base font-semibold">{intl("components_help_HelpFloatingNav.helpCenter")}</PopoverPrimitive.Title>
                <PopoverPrimitive.Description className="mt-1 text-xs leading-5 text-muted-foreground">
                  {intl("components_help_HelpFloatingNav.chooseAHelpArticle")}
                </PopoverPrimitive.Description>
              </div>
              <PopoverPrimitive.Close
                render={<Button aria-label={intl("components_help_HelpFloatingNav.closeHelpMenu")} className="size-11 rounded-full" size="icon-sm" variant="ghost" />}
              >
                <X className="size-4" aria-hidden="true" />
              </PopoverPrimitive.Close>
            </div>

            <nav aria-label={intl("components_help_HelpFloatingNav.helpNavigation")}>
              <ul className="grid gap-1">
                {helpLinks.map(({ href, content }) => {
                  const active = pathname === href;
                  const [label, description] = messageRecord(en, content).value;
                  return (
                    <li key={href}>
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex min-h-16 items-start overflow-hidden rounded-[4px] px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                          active && "bg-muted text-foreground ring-1 ring-border",
                        )}
                        to={href}
                        onClick={() => setOpenPath(null)}
                      >
                        {active ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-amber-400" /> : null}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <strong className="block text-sm font-medium group-hover:text-primary">{label}</strong>
                            {active ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                                <Check className="size-3.5" aria-hidden="true" />{intl("components_help_HelpFloatingNav.current")}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <p className="mx-3 mt-2 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              {intl("components_help_HelpFloatingNav.ifYouCannotFindAnEntryPointReturnTo")}
            </p>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
