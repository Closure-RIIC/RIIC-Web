import type { ReactNode } from "react";

export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2" data-skill-filter-row>
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <div data-yeye-scroll="auto" className="min-w-0 overflow-x-auto py-1">{children}</div>
  </div>;
}
