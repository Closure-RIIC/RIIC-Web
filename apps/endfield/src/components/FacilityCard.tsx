import { lazy, Suspense, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { workbenchArtwork } from "@riic/endfield-data";
import { useWorkspace } from "../state";
import { FacilityIcon, ProductionIcon } from "./GameArtwork";

const DijiangBackdrop = lazy(() => import("./DijiangBackdrop").then(module => ({ default: module.DijiangBackdrop })));

export type FacilityKind = "center" | "guest" | "grow" | "mfg1" | "mfg2";

export function categoryLabel(category: string, t: (zh: string, en: string) => string) {
  const labels: Record<string, string> = { 线索: "Clues", 干员经验: "Operator EXP", 武器经验: "Weapon EXP", 培养: "Growth" };
  return t(category, labels[category] ?? category);
}

export function FacilityBoard({ children, className = "", ...props }: ComponentProps<"div">) {
  const { showDijiangBackdrop } = useWorkspace();
  return <div {...props} className={`ef-ship-board ${className}`}>
    {showDijiangBackdrop ? <Suspense fallback={null}><DijiangBackdrop /></Suspense> : null}
    {children}
  </div>;
}

export function FacilityCard({ kind, label, level, category, actions, children }: {
  kind: FacilityKind; label: string; level: number; category?: string; actions?: ReactNode; children: ReactNode;
}) {
  const { workspace, t } = useWorkspace();
  const facility = workbenchArtwork.facilities[kind === "mfg1" || kind === "mfg2" ? "mfg" : kind];
  const levelLabel = t(`设施等级 ${level}`, `Facility level ${level}`);
  const productCategories = kind === "grow"
    ? Object.entries(workspace.options.grow).filter(([, slots]) => slots > 0).map(([growthKind]) => growthKind)
    : category ? [category] : [];
  const visibleCategories = productCategories.length ? productCategories : kind === "grow" ? ["培养"] : [];
  return <article className="ef-facility-tile" data-facility={kind} style={{ "--facility-color": facility.color } as CSSProperties}>
    <header>
      <FacilityIcon kind={kind} label={label} /><h3 title={label}>{label}</h3>
      <span className="ef-facility-level" role="img" aria-label={levelLabel} title={levelLabel}>
        {Array.from({ length: level }, (_, index) => <i key={index} aria-hidden />)}
      </span>
      {visibleCategories.length ? <span className="ef-facility-product" role="img" aria-label={visibleCategories.map(value => categoryLabel(value, t)).join("、")} title={visibleCategories.map(value => categoryLabel(value, t)).join("、")}>
        {visibleCategories.map(value => <ProductionIcon key={value} category={value} size={visibleCategories.length > 1 ? 20 : 36} />)}
      </span> : null}
      {actions}
    </header>
    {children}
  </article>;
}
