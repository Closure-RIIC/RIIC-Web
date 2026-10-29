import { Dialog } from "@base-ui/react/dialog";
import { SlidersHorizontal } from "lucide-react";
import { ActionContent, actionClassName, Section } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { FacilitySettings } from "./FacilitySettings";
import { PriorityCards } from "./PriorityCards";

export function ProductionDialog() {
  const { workspace, update, ready, busy, t } = useWorkspace();
  return <Dialog.Root>
    <Dialog.Trigger className={actionClassName({ size: "sm" })} disabled={!ready || busy}><ActionContent icon={<SlidersHorizontal />}>{t("ProductionDialog.productionSetup")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className="ef-production-dialog" title={t("ProductionDialog.productionSetup")} closeLabel={t("ProductionDialog.closeProductionSetup")}
        description={t("ProductionDialog.adjustFacilityLevelsProductionAndGrowthPlotsOrRestore")}
        footer={<Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("ProductionDialog.done")}</ActionContent></Dialog.Close>}>
        <FacilitySettings />
        <Section title={t("ProductionDialog.schedulingPriorities")}>
          <PriorityCards priority={workspace.options.priority} disabled={!ready || busy}
            onChange={priority => update({ ...workspace, options: { ...workspace.options, priority } })} />
          <label className="ef-toggle"><input type="checkbox" disabled={!ready || busy} checked={workspace.options.assist}
            onChange={e => update({ ...workspace, options: { ...workspace.options, assist: e.target.checked } })} />{t("ProductionDialog.enableCentralAssistance2PointsDay")}</label>
        </Section>
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
