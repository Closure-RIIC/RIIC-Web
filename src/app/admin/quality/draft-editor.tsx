"use client";

import { Link } from "@tanstack/react-router";
import { Download, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ManualOperboxPicker } from "@/components/setup/ManualOperboxPicker";
import { RotationSettings } from "@/components/RotationSettings";
import { PRESETS, maxRoomLevel, updateRoomLevel, updateFactoryRecipe, updateTradeOrder, factoryRecipeFor, tradeOrderFor } from "@/blueprint";
import { rotationDescription } from "@/rotation-settings";
import { reproductionInputKey, type ReproductionPackage } from "@/reproduction-package";
import type { QualityDraftData } from "@/quality";
import { Check, Choice, download, Panel, useWorkbenchText } from "./workbench-ui";

export function DraftEditor({ draft, input, setInput, busy, onSave }: { draft: QualityDraftData; input: ReproductionPackage; setInput: (input: ReproductionPackage) => void; busy: boolean; onSave: () => void }) {
  const { en, t } = useWorkbenchText();
  const dirty = reproductionInputKey(input) !== reproductionInputKey(draft.input);
  const changed = reproductionInputKey(input) !== reproductionInputKey(draft.original);
  const names: Record<string, string> = { control_center: t("控制中枢", "Control Center"), power_plant: t("发电站", "Power Plant"), factory: t("制造站", "Factory"), trade_post: t("贸易站", "Trading Post"), dormitory: t("宿舍", "Dormitory"), meeting_room: t("会客室", "Reception"), office: t("办公室", "Office"), workshop: t("加工站", "Workshop"), training_room: t("训练室", "Training Room") };
  const products = [{ value: "all", label: t("全部产品", "All products") }, { value: "gold", label: t("贵金属", "Precious metals") }, { value: "battle_record", label: t("作战记录", "Battle records") }, { value: "originium", label: t("源石碎片", "Originium shards") }];
  const originalOperators = new Map(draft.original.operbox.map(operator => [operator.id, operator]));
  const changedOperators = input.operbox.filter(operator => Object.entries(operator).some(([key, value]) => originalOperators.get(operator.id)?.[key as keyof typeof operator] !== value)).map(operator => operator.name);
  const removedOperators = draft.original.operbox.filter(operator => !input.operbox.some(current => current.id === operator.id)).map(operator => operator.name);

  return <Panel id="draft-editor" title={t("编辑复现草稿", "Edit reproduction draft")} description={t("修改仅用于团队测试，不会覆盖你的个人 box 或云端排班。保存后才能运行。", "Changes apply only to team tests. Your personal box and cloud schedules stay intact. Save before running.")}>
    <div className="flex flex-wrap items-center gap-2"><Badge variant={dirty ? "outline" : "secondary"}>{dirty ? t("有未保存的修改", "Unsaved changes") : t(`已保存 · 第 ${draft.revision} 版`, `Saved · revision ${draft.revision}`)}</Badge><span className="text-xs text-muted-foreground">{changed ? t("与原始输入不同", "Changed from original") : t("与原始输入一致", "Matches original")}</span></div>
    <p className="break-words text-sm">{draft.sources.map(source => source.name).join(" · ")}</p>
    <fieldset disabled={busy} className="grid min-w-0 gap-4 disabled:opacity-60">
      <Choice label={t("布局方案", "Layout preset")} value={input.layout.template} options={[...(!PRESETS.some(p => p.label === input.layout.template) ? [{ value: input.layout.template, label: input.layout.template }] : []), ...PRESETS.map(p => ({ value: p.label, label: p.label }))]} onChange={value => { const preset = PRESETS.find(p => p.label === value); if (preset) setInput({ ...input, layout: structuredClone(preset.layout) }); }} />
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t(`设施等级与生产设置 · ${input.layout.rooms.length} 个房间`, `Room levels and production · ${input.layout.rooms.length} rooms`)}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{input.layout.rooms.map(room => <div key={room.id} className="grid gap-2 rounded-lg bg-muted/40 p-3">
          <label className="grid gap-2 text-sm">{names[room.kind] ?? room.kind} · {room.id}<span className="flex items-center gap-3"><span className="text-muted-foreground">{t("等级", "Level")}</span><Input aria-label={`${names[room.kind] ?? room.kind} ${room.id} ${t("等级", "level")}`} className="w-20" type="number" min={1} max={maxRoomLevel(room.kind)} value={room.level} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) setInput({ ...input, layout: updateRoomLevel(input.layout, room.id, value) }); }} /></span></label>
          {room.kind === "factory" && <Choice label={t("生产内容", "Product")} value={factoryRecipeFor(room)} options={products} onChange={value => setInput({ ...input, layout: updateFactoryRecipe(input.layout, room.id, value as "all" | "gold" | "battle_record" | "originium") })} />}
          {room.kind === "trade_post" && <Choice label={t("订单类型", "Order type")} value={tradeOrderFor(room)} options={[{ value: "gold", label: t("龙门商法", "LMD orders") }, { value: "originium", label: t("开采协力", "Orundum orders") }]} onChange={value => setInput({ ...input, layout: updateTradeOrder(input.layout, room.id, value as "gold" | "originium") })} />}
        </div>)}</div>
      </details>
      <RotationSettings value={input.rotation} onChange={rotation => setInput({ ...input, rotation })} />
      <Check label={t("启用菲亚梅塔回满心情", "Enable Fiammetta morale recovery")} checked={input.fiammetta_enable} onChange={value => setInput({ ...input, fiammetta_enable: value })} />
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t(`干员与练度 · ${input.operbox.length} 名干员`, `Operators and levels · ${input.operbox.length} operators`)}</summary><div className="mt-3"><ManualOperboxPicker operbox={input.operbox} onApply={operbox => setInput({ ...input, operbox })} compact /></div></details>
    </fieldset>
    {changed && <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm"><h3 className="font-medium">{t("相对原始输入的变化", "Changes from the original input")}</h3><ul className="list-inside list-disc space-y-1 text-muted-foreground">
      {JSON.stringify(input.layout) !== JSON.stringify(draft.original.layout) && <li>{t("布局或设施设置已调整", "Layout or room settings changed")}</li>}
      {input.rotation !== draft.original.rotation && <li>{rotationDescription(draft.original.rotation, en)} → {rotationDescription(input.rotation, en)}</li>}
      {input.fiammetta_enable !== draft.original.fiammetta_enable && <li>{input.fiammetta_enable ? t("已启用菲亚梅塔", "Fiammetta enabled") : t("已停用菲亚梅塔", "Fiammetta disabled")}</li>}
      {!!changedOperators.length && <li>{t("新增或调整干员：", "Added or changed: ")}{changedOperators.join("、")}</li>}
      {!!removedOperators.length && <li>{t("移除干员：", "Removed: ")}{removedOperators.join("、")}</li>}
    </ul><details><summary className="cursor-pointer">{t("查看完整输入对照", "View full input comparison")}</summary><div className="mt-2 grid min-w-0 gap-3 md:grid-cols-2">{[[t("原始输入", "Original"), draft.original], [t("当前输入", "Current"), input]].map(([label, value]) => <div className="min-w-0" key={String(label)}><h4>{String(label)}</h4><div data-yeye-scroll="auto" className="max-h-64 overflow-auto whitespace-pre rounded border p-2 text-xs"><pre className="m-0 whitespace-[inherit]">{JSON.stringify(value, null, 2)}</pre></div></div>)}</div></details></div>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={onSave}><Save aria-hidden="true" />{t("保存并选中草稿", "Save and select draft")}</Button>{dirty && <Button variant="outline" disabled={busy} onClick={() => setInput(structuredClone(draft.input))}>{t("放弃未保存修改", "Discard unsaved changes")}</Button>}<Button variant="ghost" disabled={busy || !changed} onClick={() => setInput(structuredClone(draft.original))}><RotateCcw aria-hidden="true" />{t("恢复原始输入", "Restore original input")}</Button><Button variant="ghost" onClick={() => download("reproduction.json", input)}><Download aria-hidden="true" />{t("导出复现包", "Export reproduction")}</Button></div>
    {draft.sources.filter(source => source.feedbackId).map(source => <Link className="text-sm underline underline-offset-4" key={source.feedbackId} to="/admin/issues" search={{ q: encodeURIComponent(source.feedbackId!) }}>{t("返回来源反馈", "Back to source feedback")} · {source.name}</Link>)}
  </Panel>;
}
