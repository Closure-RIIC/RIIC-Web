"use client"

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDown } from "lucide-react"
import { motion, type HTMLMotionProps } from "motion/react"

import { cn } from "@/lib/utils"
import { MOTION_DURATION, MOTION_EASE_IN_OUT } from "@/motion"

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        "overflow-hidden rounded-[6px] border border-border/80 bg-background/56 data-panel-open:border-foreground/18",
        className
      )}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="m-0">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition-colors duration-150 ease-out hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        render={(renderProps, state) => (
          <motion.button
            {...(renderProps as unknown as HTMLMotionProps<"button">)}
          >
            {children}
            <motion.span
              className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              animate={{ rotate: state.open ? 180 : 0 }}
              transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE_IN_OUT }}
              aria-hidden="true"
            >
              <ChevronDown className="size-4" />
            </motion.span>
          </motion.button>
        )}
        {...props}
      />
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-panel"
      className={cn("overflow-hidden border-t border-border/70", className)}
      {...props}
    >
      {children}
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionPanel, AccordionTrigger }
