"use client";

import { Check, FlaskConical } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ONBOARDING_VISIT_PAGES, type OnboardingStepStatus, type OnboardingVisitPage } from "@/onboarding";
import styles from "./OnboardingChecklist.module.css";

export function OnboardingChecklist({ open, onOpenChange, statuses, visitedPages, onNavigate, generating, generateDisabled, plannerReady, showSample, sampleDisabled, onSample, onSignIn, onImport, onGenerate, onDismiss }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: readonly OnboardingStepStatus[];
  visitedPages: readonly OnboardingVisitPage[];
  onNavigate: (page: OnboardingVisitPage) => void;
  generating: boolean;
  generateDisabled: boolean;
  plannerReady: boolean;
  showSample: boolean;
  sampleDisabled: boolean;
  onSample: () => void;
  onSignIn: () => void;
  onImport: () => void;
  onGenerate: () => void;
  onDismiss: () => boolean;
}) {
  const text = useTranslations("Onboarding");
  const intl = useTranslations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const visitCopy: Record<OnboardingVisitPage, { title: string; description: string }> = {
    manual: { title: text("manualTitle"), description: text("manualDescription") },
    training: { title: text("trainingTitle"), description: text("trainingDescription") },
    "skill-query": { title: text("skillsTitle"), description: text("skillsDescription") },
    recruitment: { title: text("recruitmentTitle"), description: text("recruitmentDescription") },
    "training-planner": { title: text("upgradeTitle"), description: text("upgradeDescription") },
    settings: { title: text("settingsTitle"), description: text("settingsDescription") },
  };
  const coreTasks = [
    { id: "account", title: text("signInTitle"), description: text("signInDescription"), action: text("signInAction"), onAction: onSignIn },
    { id: "box", title: text("boxTitle"), description: text("boxDescription"), action: text("boxAction"), onAction: onImport },
    { id: "plan", title: text("planTitle"), description: text("planDescription"), action: generating ? (text("generating")) : (text("planAction")), onAction: onGenerate },
  ];
  const tasks = [
    ...coreTasks.map((task, index) => ({ ...task, status: statuses[index] })),
    ...ONBOARDING_VISIT_PAGES.map(id => ({ id, ...visitCopy[id], action: text("explore"), onAction: () => onNavigate(id), status: visitedPages.includes(id) ? "complete" : "current" })),
  ];
  const completed = tasks.filter(task => task.status === "complete").length;
  const close = (next: boolean) => {
    if (!next) { setConfirmOpen(false); setSaveFailed(false); }
    onOpenChange(next);
  };
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent closeLabel={text("close")} aria-describedby={undefined} className={styles.panel} data-onboarding-checklist>
      <DialogHeader className={styles.header}>
        <div className={styles.headingRow}>
          <DialogTitle>{text("title")}</DialogTitle>
          <span className={styles.count} aria-live="polite" data-onboarding-progress>{text("progress", { completed, total: tasks.length })}</span>
        </div>
      </DialogHeader>
      <DialogBody className={styles.body}>
        <ol className={styles.tasks} aria-label={text("taskListLabel")}>
          {tasks.map((task, index) => {
            const status = task.status;
            const done = status === "complete";
            return <li key={task.id} className={styles.task} data-onboarding-task={task.id} data-status={status} style={{ animationDelay: `${80 + index * 50}ms` }}>
              <h3 className={styles.title}>{task.title}</h3>
              <p className={styles.description}>{task.description}</p>
              <div className={styles.taskAction}>
                {done ? <span className={styles.done} data-onboarding-done role="status"><span className={styles.checkmark}><Check className="size-3" aria-hidden="true" /></span>{text("completed")}</span> : <Button type="button" size="sm" variant={status === "current" && index < coreTasks.length ? "default" : "outline"} className={styles.actionButton}
                  disabled={status === "upcoming" || (task.id === "plan" && generateDisabled)}
                  onClick={() => { close(false); task.onAction(); }}>{task.action}</Button>}
              </div>
              {task.id === "plan" && status === "current" && generateDisabled && !generating ? <p className={styles.description}>{plannerReady ? (text("planRetryHint")) : (text("plannerUnavailable"))}</p> : null}
            </li>;
          })}
        </ol>
        {showSample ? <section className={styles.sample} data-anonymous-sample-trial>
          <h3 className="text-sm font-medium">{intl("components_pages_InfraCalculator.wantToPreviewSchedulingWithoutSigningIn")}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{intl("components_pages_InfraCalculator.useServerSideSampleDataToGenerateABrowsable")}</p>
          <Button type="button" variant="outline" className={styles.actionButton} disabled={sampleDisabled} onClick={() => { close(false); onSample(); }}>
            <FlaskConical className="size-4" aria-hidden="true" />{intl("components_pages_InfraCalculator.viewSampleSchedule")}
          </Button>
        </section> : null}
      </DialogBody>
      <DialogFooter className={styles.footer}>
        <Button type="button" size="sm" variant="secondary" className={styles.dismissButton} onClick={() => { setSaveFailed(false); setConfirmOpen(true); }}>{text("dismiss")}</Button>
        <Button type="button" size="dialog" variant="outline" className={styles.continueButton} onClick={() => close(false)}>{text("continueLater")}</Button>
      </DialogFooter>
    </DialogContent>
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent role="alertdialog" layer="nested" closeLabel={text("cancel")}>
        <DialogHeader>
          <DialogTitle>{text("confirmTitle")}</DialogTitle>
          <DialogDescription>{text("confirmDescription")}</DialogDescription>
        </DialogHeader>
        {saveFailed ? <DialogBody><p role="alert" className="text-sm text-destructive">{text("saveFailed")}</p></DialogBody> : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirmOpen(false)}>{text("keep")}</Button>
          <Button type="button" className="min-h-11" onClick={() => { if (onDismiss()) close(false); else setSaveFailed(true); }}>{text("confirmDismiss")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Dialog>;
}
