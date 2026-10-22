import type { ComponentProps, CSSProperties } from "react";

import dialogueStyles from "@/components/agent/beautiful/Dialogue.module.css";
import { cn } from "@/lib/utils";
import styles from "./WorkbenchCard.module.css";

export function WorkbenchCard({ children, className, glass = false, accent, style, ...props }: ComponentProps<"section"> & {
  glass?: boolean;
  accent?: string;
}) {
  return <section
    {...props}
    className={cn(styles.card, className)}
    style={accent ? { "--dialogue-accent": accent, ...style } as CSSProperties : style}
    data-workbench-card
  >
    {glass ? <span aria-hidden="true" className={dialogueStyles.decoration} data-workbench-card-decoration /> : null}
    {children}
  </section>;
}
