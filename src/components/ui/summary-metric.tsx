import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared label, value and unit treatment for production and archive summaries. */
export function SummaryMetric({ label, value, unit, note, reserveIconSpace = true }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  reserveIconSpace?: boolean;
}) {
  return <>
    <span className={cn("font-number block truncate text-[10px] font-medium tracking-[0.06em] text-[#313131]/58", reserveIconSpace && "pr-6")}>{label}</span>
    <strong className="font-technical mt-1 flex min-w-0 items-baseline gap-1 leading-none tabular-nums">
      <span className="truncate text-[clamp(1rem,1.5vw,1.35rem)] font-semibold">{value}</span>
      {unit ? <span className="shrink-0 text-[9px] font-medium text-[#313131]/45">{unit}</span> : null}
    </strong>
    {note}
  </>;
}
