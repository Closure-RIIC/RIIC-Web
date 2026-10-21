import { Dialog } from "@base-ui/react/dialog";
import { SlidersHorizontal } from "lucide-react";
import { ActionContent, actionClassName, Section } from "@shared/endfield-ui";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { ProductionSettings } from "./ProductionSettings";
import { PriorityCards } from "./PriorityCards";

export function ProductionDialog() {
  const { workspace, update, ready, busy, t } = useWorkspace();
  return <Dialog.Root>
    <Dialog.Trigger className={actionClassName({ size: "sm" })} disabled={!ready || busy}><ActionContent icon={<SlidersHorizontal />}>{t("生产配置", "Production setup")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className="ef-production-dialog" title={t("生产配置", "Production setup")} closeLabel={t("关闭生产配置", "Close production setup")}
        description={t("设置制造产物与培养位分配，修改会自动保存并用于排班。设施等级可在手动排班中调整。", "Choose production types and growth plots. Changes are saved automatically and used for scheduling. Adjust facility levels in manual scheduling.")}
        footer={<Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>}>
        <ProductionSettings />
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
