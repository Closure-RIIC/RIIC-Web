import { cn } from "./utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-[5px] bg-stone-200 dark:bg-white/15", className)}
      {...props}
    />
  )
}

export { Skeleton }
