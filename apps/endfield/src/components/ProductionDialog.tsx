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
    <Dialog.Trigger className={actionClassName({ size: "sm" })} disabled={!ready || busy}><ActionContent icon={<SlidersHorizontal />}>{t("生产配置", "Production setup")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className="ef-production-dialog" title={t("生产配置", "Production setup")} closeLabel={t("关闭生产配置", "Close production setup")}
        description={t("调整各舱室等级、制造产物与培养位分配；也可恢复账号实际配置。修改自动保存并用于排班。", "Adjust facility levels, production and growth plots, or restore your actual account setup. Changes are saved automatically.")}
        footer={<Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>}>
        <FacilitySettings />
        <Section title={t("排班目标", "Scheduling priorities")}>
          <PriorityCards priority={workspace.options.priority} disabled={!ready || busy}
            onChange={priority => update({ ...workspace, options: { ...workspace.options, priority } })} />
          <label className="ef-toggle"><input type="checkbox" disabled={!ready || busy} checked={workspace.options.assist}
            onChange={e => update({ ...workspace, options: { ...workspace.options, assist: e.target.checked } })} />{t("启用中枢助力（每日 2 点）", "Enable central assistance (2 points/day)")}</label>
        </Section>
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
