"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { DialogBody, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";
import billingStyles from "@/components/billing/BillingPrototype.module.css";
import personaStyles from "./PersonaPreview.module.css";
import { FrostCloud } from "./clouds/FrostCloud";
import { GlowCloud } from "./clouds/GlowCloud";
import { useAgentAppearance, type AgentAppearance } from "./agent-appearance-store";
import styles from "./AgentAppearancePicker.module.css";

export function AgentAppearancePicker({ title, closureName, disabled, children }: {
  title: string;
  closureName: string;
  disabled: boolean;
  children: (selection: { appearance: AgentAppearance; onAppearanceChange: (value: AgentAppearance) => void; cloudCards: ReactNode }) => ReactNode;
}) {
  const text = useTranslations("AgentAppearance");
  const [appearance, setAppearance] = useAgentAppearance();
  const [saveFailed, setSaveFailed] = useState(false);
  const choose = (value: AgentAppearance) => setSaveFailed(!setAppearance(value));
  const cloudCards = (["frost-cloud", "glow-cloud"] as const).map(value => {
    const selected = appearance === value;
    const Cloud = value === "frost-cloud" ? FrostCloud : GlowCloud;
    const name = value === "frost-cloud" ? closureName : text("glowName");
    const theme = value === "frost-cloud" ? personaStyles.closure : billingStyles.monthly;
    return <WorkbenchCard key={value} glass className={`${personaStyles.preview} ${theme}`} data-cloud-card={value} data-persona-theme={value === "frost-cloud" ? "red" : "blue"} data-selected={selected ? "true" : undefined}>
      <button type="button" className={styles.select} disabled={disabled} aria-pressed={selected} aria-label={text("selectCloud", { name })} onClick={() => choose(value)}>
        <div className={personaStyles.identity}>
          <div className={personaStyles.portrait}><Cloud background={false} label={name} className={styles.cloudArt} /></div>
          <h3 className={personaStyles.name}>{name}</h3>
        </div>
      </button>
    </WorkbenchCard>;
  });
  return <>
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
    </DialogHeader>
    <DialogBody className="min-h-0 overflow-y-auto overscroll-contain pb-5 sm:pb-7">
      {saveFailed ? <p role="status" className="text-xs text-muted-foreground">{text("saveFailed")}</p> : null}
      {children({ appearance, onAppearanceChange: choose, cloudCards })}
    </DialogBody>
  </>;
}
