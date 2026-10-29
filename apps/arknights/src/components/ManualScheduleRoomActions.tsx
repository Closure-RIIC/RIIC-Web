"use client";
import { useTranslations } from "use-intl";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { DroneIcon } from "@/components/DroneIcon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RoomRow } from "@/schedule";

export function ManualScheduleRoomActions({ row, position, roomTitle, onClearRoom, onDormAutofillChange, droneTargetRoomId, onDroneTargetChange, sortMode, onSortToggle }: {
  row: RoomRow;
  position: "header" | "secondary" | "clear";
  roomTitle: string;
  onClearRoom: (row: RoomRow) => void;
  onDormAutofillChange: (row: RoomRow, enabled: boolean) => void;
  droneTargetRoomId?: string | null;
  onDroneTargetChange: (row: RoomRow) => void;
  sortMode?: boolean;
  onSortToggle?: (row: RoomRow) => void;
}) {
  const intl = useTranslations();
  if (position === "secondary") {
    return row.group === "dormitory" && onDormAutofillChange ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={row.autofill}
        aria-label={`${roomTitle}${intl("components.label")}${intl("components.autoFill")}`}
        className={cn(
          "hidden h-7 w-full max-w-[220px] border px-2 text-xs text-white hover:text-white sm:inline-flex",
          row.autofill ? "border-[#FFD800]/70 bg-[#FFD800]/18 hover:bg-[#FFD800]/28" : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]",
        )}
        onClick={() => onDormAutofillChange(row, !row.autofill)}
      >
        {intl("components.autoFill")}
      </Button>
    ) : null;
  }
  return position === "header" ? (
    <>
      {row.group === "dormitory" && onDormAutofillChange ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={row.autofill}
          aria-label={`${roomTitle}${intl("components.label")}${intl("components.autoFill")}`}
          className={cn(
            "h-7 w-auto border px-2 text-xs text-white hover:text-white sm:hidden",
            row.autofill ? "border-[#FFD800]/70 bg-[#FFD800]/18 hover:bg-[#FFD800]/28" : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]",
          )}
          onClick={() => onDormAutofillChange(row, !row.autofill)}
        >
          {intl("components.autoFill")}
        </Button>
      ) : null}
      {(row.group === "trading" || row.group === "manufacture") && onDroneTargetChange ? (
      <Tooltip>
      <TooltipTrigger
      render={
      <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={droneTargetRoomId === row.roomId}
      aria-label={intl("components_CompactScheduleView.droneAcceleration", { roomTitle: roomTitle })}
      className={cn(
      "ml-auto h-7 border px-2 text-xs text-purple-200 hover:text-purple-100 focus-visible:border-purple-400 focus-visible:ring-purple-400/40",
      droneTargetRoomId === row.roomId ? "border-purple-400/70 bg-purple-400/18 hover:bg-purple-400/28" : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]",
      )}
      onClick={() => onDroneTargetChange(row)}
      >
      <DroneIcon className="size-3.5 drop-shadow-[0_0_2px_#c084fc]" />
      <span className="sm:hidden">{intl("components_CompactScheduleView.drones")}</span>
      </Button>
      }
      />
      <TooltipContent side="left">
      {droneTargetRoomId === row.roomId
      ? intl("components_CompactScheduleView.disableDroneAcceleration")
      : intl("components_CompactScheduleView.useDronesForShift")}
      </TooltipContent>
      </Tooltip>
      ) : null}
      {(row.group === "trading" || row.group === "manufacture") && onSortToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={sortMode}
          aria-label={sortMode ? intl("Common.sortDone") : intl("Common.sortOperators")}
          className={cn(
            "ml-1 h-7 w-7 border text-white hover:text-white",
            sortMode ? "border-[#FFD800]/70 bg-[#FFD800]/18" : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]",
          )}
          onClick={() => onSortToggle(row)}
        >
          <ArrowLeftRight className="size-3.5" />
        </Button>
      ) : null}
    </>
  ) : (
    <>
      {onClearRoom ? <Tooltip>
      <TooltipTrigger
      render={
      <span className="absolute right-2 top-2 z-20">
      <Button
      type="button"
      variant="destructive"
      size="sm"
      className="h-7 border border-red-400/30 bg-red-950/70 px-2 text-xs text-red-200 hover:bg-red-900/80 hover:text-red-100 max-sm:h-11"
      aria-label={intl("components_CompactScheduleView.clearRoom", { roomTitle: roomTitle })}
      onClick={() => onClearRoom(row)}
      >
      <Trash2 className="size-3.5" /><span className="sm:hidden">{intl("components_CompactScheduleView.clear")}</span>
      </Button>
      </span>
      }
      />
      <TooltipContent side="left">{intl("components_CompactScheduleView.clearThisFacility")}</TooltipContent>
      </Tooltip> : null}
    </>
  );
}
