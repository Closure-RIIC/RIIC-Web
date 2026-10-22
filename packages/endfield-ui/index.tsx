import { useId, type ReactNode } from "react";
import { FilterSelect, type FilterSelectProps } from "@riic/ui-primitives/filter-select";
export { Action, ActionLink, ActionContent, actionClassName, type ActionProps, type ActionLinkProps, type ActionVariant, type ActionSize } from "./action";
export function Field({ label, hint, leading, ...props }: FilterSelectProps & { label: string; hint?: string; leading?: ReactNode }) {
  const id = useId();
  return <div className="ef-field"><label htmlFor={id}>{label}</label><div className="ef-field-control">{leading}<FilterSelect id={id} {...props} /></div>{hint ? <small>{hint}</small> : null}</div>;
}
export function Section({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="ef-section">{title || actions ? <header>{title ? <h2>{title}</h2> : null}{actions ? <div className="ef-section-actions">{actions}</div> : null}</header> : null}{children}</section>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`ef-notice${error ? " ef-notice--error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}
export function PageTitle({ title, subtitle, action, meta, accent = "bar" }: { title: string; subtitle: string; action?: ReactNode; meta?: ReactNode; accent?: "bar" | "chevrons" }) {
  return <header className="ef-title"><div className="ef-title-copy"><div className="ef-title-heading"><h1>
    {accent === "chevrons" ? <span className="ef-title-chevrons" aria-hidden="true"><span /><span /><span /></span> : <span className="ef-title-accent" aria-hidden="true" />}
    <span>{title}</span>
  </h1>{meta}</div><p className="ef-subtitle">{subtitle}</p></div>{action}</header>;
}
