import type { ComponentPropsWithRef, ReactNode } from "react";
import "./action.css";

export type ActionVariant = "dark" | "yellow" | "red" | "white";
export type ActionSize = "default" | "sm";
export interface ActionAppearance {
  variant?: ActionVariant;
  size?: ActionSize;
  iconOnly?: boolean;
  className?: string;
}
export interface ActionContentProps {
  children?: ReactNode;
  icon?: ReactNode;
}

/** Also usable with router links and headless controls without changing their semantics. */
export function actionClassName({ variant = "white", size = "default", iconOnly = false, className = "" }: ActionAppearance = {}) {
  return `ef-action ef-action--${variant} ef-action--${size}${iconOnly ? " ef-action--icon-only" : ""}${className ? ` ${className}` : ""}`;
}

export function ActionContent({ children, icon }: ActionContentProps) {
  return <span className="ef-action-inner">
    {children !== undefined && children !== null ? <span className="ef-action-track">
      <span className="ef-action-line" aria-hidden="true" />
      <span className="ef-action-label">{children}</span>
    </span> : null}
    {icon ? <span className="ef-action-icon" aria-hidden="true">{icon}</span> : null}
  </span>;
}

export type ActionProps = Omit<ComponentPropsWithRef<"button">, "children"> & ActionAppearance & ActionContentProps;

/** Endfield's contour control, adapted from uriyoo-2.0's ContourButton. */
export function Action({ variant, size, iconOnly, className, icon, children, type = "button", ...props }: ActionProps) {
  return <button {...props} type={type} className={actionClassName({ variant, size, iconOnly, className })}>
    <ActionContent icon={icon}>{children}</ActionContent>
  </button>;
}

export type ActionLinkProps = Omit<ComponentPropsWithRef<"a">, "children"> & ActionAppearance & ActionContentProps & { disabled?: boolean };
export function ActionLink({ variant, size, iconOnly, className, icon, children, disabled = false, href, onClick, tabIndex, role, ...props }: ActionLinkProps) {
  return <a {...props} href={disabled ? undefined : href} role={disabled ? "link" : role}
    aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : tabIndex}
    className={actionClassName({ variant, size, iconOnly, className })}
    onClick={event => { if (disabled) { event.preventDefault(); event.stopPropagation(); } else onClick?.(event); }}>
    <ActionContent icon={icon}>{children}</ActionContent>
  </a>;
}
