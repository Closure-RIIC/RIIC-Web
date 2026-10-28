import type { EndfieldInventory, EndfieldInventoryItem } from "./inventory.ts";

type ExperienceCategory = "carrier" | "record" | "weapon";

const ITEM_EXPERIENCE: Readonly<Record<string, { category: ExperienceCategory; experience: number }>> = {
  item_expcard_stage1_low: { category: "record", experience: 200 },
  item_expcard_stage1_mid: { category: "record", experience: 1_000 },
  item_expcard_stage1_high: { category: "record", experience: 10_000 },
  item_expcard_stage2_low: { category: "carrier", experience: 1_000 },
  item_expcard_stage2_high: { category: "carrier", experience: 10_000 },
  item_weapon_expcard_low: { category: "weapon", experience: 200 },
  item_weapon_expcard_mid: { category: "weapon", experience: 1_000 },
  item_weapon_expcard_high: { category: "weapon", experience: 10_000 },
};

export interface InventoryExperienceSummary {
  operator: { carriers: number; records: number } | null;
  weapon: number | null;
}

const itemExperience = (item: EndfieldInventoryItem) => ITEM_EXPERIENCE[item.id];
const sumItems = (items: EndfieldInventoryItem[], category: ExperienceCategory) => items.reduce((total, item) => {
  const experience = itemExperience(item);
  return experience?.category === category && item.count !== null ? total + experience.experience * item.count : total;
}, 0);

export function inventoryExperienceSummary(inventory?: EndfieldInventory): InventoryExperienceSummary {
  const operatorItems = inventory?.items.filter(item => item.group === "charExpMaterials") ?? [];
  const operatorComplete = operatorItems.length > 0 && operatorItems.every(item => {
    const category = itemExperience(item)?.category;
    return (category === "carrier" || category === "record") && item.count !== null;
  });
  const carriers = sumItems(operatorItems, "carrier");
  const records = sumItems(operatorItems, "record");

  const weaponItems = inventory?.items.filter(item => item.group === "weaponExpMaterials") ?? [];
  const weaponComplete = weaponItems.length > 0 && weaponItems.every(item =>
    itemExperience(item)?.category === "weapon" && item.count !== null);

  return {
    operator: operatorComplete ? { carriers, records } : null,
    weapon: weaponComplete ? sumItems(weaponItems, "weapon") : null,
  };
}
