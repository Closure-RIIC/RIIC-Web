"use client";

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
  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>选择无人机去向</DialogTitle>
        <DialogDescription>选择当前班次的目标房间，点击当前目标可取消。</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 p-4">
        {rows.filter(row => row.group === "trading" || row.group === "manufacture").map(row => <Button key={row.roomId} type="button" variant={targetRoomId === row.roomId ? "default" : "outline"} className={`justify-start ${targetRoomId === row.roomId ? "bg-purple-600 text-white hover:bg-purple-700" : ""}`} onClick={() => { onTargetChange?.(row); onOpenChange(false); }}>{row.title}</Button>)}
        <Button type="button" variant="ghost" className="justify-start" onClick={() => { const current = rows.find(row => row.roomId === targetRoomId); if (current) onTargetChange?.(current); onOpenChange(false); }}>不使用无人机</Button>
      </div>
      <DialogFooter>
        {manualSelection && onAutoAllocation ? <Button type="button" variant="outline" onClick={() => { onAutoAllocation(); onOpenChange(false); }}>恢复自动分配</Button> : null}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
