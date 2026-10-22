"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex min-w-0 gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-yeye-scroll="auto"
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-0 h-[var(--active-tab-height)] w-[var(--active-tab-width)] transition-transform duration-240 ease-[var(--motion-ease-out)] motion-reduce:transition-none",
          variant === "line"
            ? "bg-foreground data-[orientation=horizontal]:h-0.5 data-[orientation=vertical]:w-0.5"
            : "rounded-md border border-transparent bg-background shadow-sm dark:border-input dark:bg-input/30"
        )}
        style={({ orientation }) => ({
          transform: variant === "line"
            ? orientation === "vertical"
              ? "translate(calc(var(--active-tab-left) + var(--active-tab-width) + 2px), var(--active-tab-top))"
              : "translate(var(--active-tab-left), calc(var(--active-tab-top) + var(--active-tab-height) + 3px))"
            : "translate(var(--active-tab-left), var(--active-tab-top))",
        })}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none max-sm:min-h-11 max-sm:min-w-11 max-sm:px-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "z-10 bg-transparent data-active:text-foreground dark:data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-w-0 flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
