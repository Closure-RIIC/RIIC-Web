import { Dialog } from "@base-ui/react/dialog";
import { SlidersHorizontal } from "lucide-react";
import { ActionContent, actionClassName, Section } from "@riic/endfield-ui";
import { DEFAULT_OPTIONS } from "@riic/endfield-solver/model.mjs";
import { gameLabel } from "../i18n/game-labels";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { FacilitySettings } from "./FacilitySettings";
import { PriorityCards } from "./PriorityCards";

const CLUE_ITEMS = ["1", "2", "3", "4", "5", "6", "7", "白板"];

export function ProductionDialog() {
  const { workspace, update, ready, busy, t } = useWorkspace();
  const clueItems = CLUE_ITEMS.map(id => ({
    id, label: id === "白板" ? t("PriorityCards.whiteboard") : gameLabel(t, `线索 ${id}`),
  }));
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
        <Section title={t("PriorityCards.cluePriorities")}>
          <PriorityCards priority={workspace.options.cluePriority ?? DEFAULT_OPTIONS.cluePriority} disabled={!ready || busy}
            items={clueItems} hint={t("PriorityCards.clueHint")} ariaLabel={t("PriorityCards.cluePriorities")}
            onChange={cluePriority => update({ ...workspace, options: { ...workspace.options, cluePriority } })} />
        </Section>
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
