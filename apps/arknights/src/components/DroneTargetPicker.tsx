"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../messages/zh-CN/AK_Raw_components_DroneTargetPicker.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_DroneTargetPicker");


import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RoomRow } from "@/schedule";

export function DroneTargetPicker({ rows, targetRoomId, manualSelection, onTargetChange, onAutoAllocation, onOpenChange }: {
  rows: RoomRow[];
  targetRoomId?: string | null;
  manualSelection: boolean;
  onTargetChange?: (row: RoomRow) => void;
  onAutoAllocation?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const rawLocale = useRawLocale();
  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{rawText.text(rawLocale, "chooseDroneDestination")}</DialogTitle>
        <DialogDescription>{rawText.text(rawLocale, "selectARoomForTheCurrentShiftSelectThe")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 p-4">
        {rows.filter(row => row.group === "trading" || row.group === "manufacture").map(row => <Button key={row.roomId} type="button" variant={targetRoomId === row.roomId ? "default" : "outline"} className={`justify-start ${targetRoomId === row.roomId ? "bg-purple-600 text-white hover:bg-purple-700" : ""}`} onClick={() => { onTargetChange?.(row); onOpenChange(false); }}>{row.title}</Button>)}
        <Button type="button" variant="ghost" className="justify-start" onClick={() => { const current = rows.find(row => row.roomId === targetRoomId); if (current) onTargetChange?.(current); onOpenChange(false); }}>{rawText.text(rawLocale, "doNotUseDrones")}</Button>
      </div>
      <DialogFooter>
        {manualSelection && onAutoAllocation ? <Button type="button" variant="outline" onClick={() => { onAutoAllocation(); onOpenChange(false); }}>{rawText.text(rawLocale, "restoreAutomaticAllocation")}</Button> : null}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{rawText.text(rawLocale, "cancel")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
