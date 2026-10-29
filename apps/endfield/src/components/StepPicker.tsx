import { Dialog } from "@base-ui/react/dialog";
import { Action, ActionContent, actionClassName } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { RosterPage } from "./RosterPage";

export function StepPicker({ open, title, current, unavailable, onSelect, onClear, onClose }: {
  open: boolean; title: string; current: string | null; unavailable: ReadonlySet<string>;
  onSelect: (name: string) => void; onClear: () => void; onClose: () => void;
}) {
  const { t } = useWorkspace();
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame title={title} closeLabel={t("StepPicker.closeOperatorSelection")}
        className="ef-roster-dialog" bodyClassName="ef-roster-dialog-body"
        description={t("StepPicker.chooseFromYourRosterUnavailableAssignmentsOrAssistanceTargets")}
        footer={<>
          <Action size="sm" disabled={!current} onClick={onClear}>{t("StepPicker.clearSelection")}</Action>
          <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("StepPicker.cancel")}</ActionContent></Dialog.Close>
        </>}>
        {open ? <RosterPage embedded picker={{ value: current ?? "", unavailable, unavailableLabel: t("StepPicker.notScheduled"), onSelect }} /> : null}
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
