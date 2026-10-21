import { operatorPresentationFor } from "./operatorPortraits";
import type { RoomRow } from "./schedule";

export function addOperatorPresentations(rows: RoomRow[]): RoomRow[] {
  return rows.map((row) => ({
    ...row,
    operatorSlots: row.operatorSlots.map((slot) => {
      const presentation = operatorPresentationFor({ name: slot.name, skill: slot.skill });
      return {
        ...slot,
        profession: presentation.operator?.profession,
        portrait: presentation.portrait,
        buildingSkill: presentation.buildingSkill,
      };
    }),
    ...(row.slotAssignments ? {
      slotAssignments: row.slotAssignments.map((slot) => {
        if (!slot) return undefined;
        const presentation = operatorPresentationFor({ name: slot.name, skill: slot.skill });
        return {
          ...slot,
          profession: presentation.operator?.profession,
          portrait: presentation.portrait,
          buildingSkill: presentation.buildingSkill,
        };
      }),
    } : {}),
    ...(row.positionSlots ? {
      positionSlots: row.positionSlots.map((positionSlot) => {
        if (!positionSlot.slot) return positionSlot;
        const presentation = operatorPresentationFor({
          name: positionSlot.slot.name,
          skill: positionSlot.slot.skill,
        });
        return {
          ...positionSlot,
          slot: {
            ...positionSlot.slot,
            profession: presentation.operator?.profession,
            portrait: presentation.portrait,
            buildingSkill: presentation.buildingSkill,
          },
        };
      }),
    } : {}),
  }));
}
