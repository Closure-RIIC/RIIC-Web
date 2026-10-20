import { useRef, useState, type ComponentProps } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Action, ActionContent, actionClassName } from "@shared/endfield-ui";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";

type Props = Omit<ComponentProps<typeof Action>, "onClick" | "title"> & {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export function ConfirmAction({ title, description, confirmLabel, onConfirm, children, icon, iconOnly, variant, size = "sm", disabled, className = "", ...props }: Props) {
  const { t } = useWorkspace();
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger {...props} className={actionClassName({ variant, size, iconOnly, className })} disabled={disabled}>
      <ActionContent icon={icon}>{children}</ActionContent>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className="ef-confirm-dialog" title={title} description={description} closeLabel={t("关闭", "Close")} initialFocus={cancel}
        footer={<>
          <Dialog.Close ref={cancel} className={actionClassName({ size: "sm" })}><ActionContent>{t("取消", "Cancel")}</ActionContent></Dialog.Close>
          <Action size="sm" variant="red" disabled={disabled} onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</Action>
        </>}>
        {null}
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
