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
      <DialogFrame title={title} closeLabel={t("关闭干员选择", "Close operator selection")}
        className="ef-roster-dialog" bodyClassName="ef-roster-dialog-body"
        description={t("从我的干员中选择；不可用的工位或助力目标会禁用。", "Choose from your roster. Unavailable assignments or assistance targets are disabled.")}
        footer={<>
          <Action size="sm" disabled={!current} onClick={onClear}>{t("清空选择", "Clear selection")}</Action>
          <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("取消", "Cancel")}</ActionContent></Dialog.Close>
        </>}>
        {open ? <RosterPage embedded picker={{ value: current ?? "", unavailable, unavailableLabel: t("未排班", "Not scheduled"), onSelect }} /> : null}
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
