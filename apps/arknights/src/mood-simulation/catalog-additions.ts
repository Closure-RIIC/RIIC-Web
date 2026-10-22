import type { Skill } from "./rules.ts";

// New operators absent from the pinned reference. Effects and unlock groups are
// checked against building_data.json / character_table.json in ArknightsGameData.
// Keep these separate so regenerating the reference catalog cannot erase them.
export function moodCatalogAdditions(reference: Record<string, Skill>) {
  const clone = (source: string, id: string, name: string, patch: Partial<Skill> = {}): Skill => ({
    ...reference[source]!, id, name, ...patch,
  });
  const skills = {
    "meet_spd&cost_110#1": clone("hire_spd_cost_220#1", "meet_spd&cost_110#1", "谈判技巧", { facility_types: ["reception"] }),
    "meet_spd&cost_char_000#1": clone("hire_spd_cost_220#1", "meet_spd&cost_char_000#1", "合作原则", { facility_types: ["reception"], condition: { name: "_cond_with_other_operator", args: [] } }),
    "hire_spd_cost_113#1": clone("trade_ord_limit&cost_000#1", "hire_spd_cost_113#1", "拉拢听众", { facility_types: ["office"] }),
    "hire_spd_cost_122#1": clone("trade_ord_limit&cost_000#1", "hire_spd_cost_122#1", "聚众宣讲", { facility_types: ["office"] }),
    "dorm_hireToRecAll_002#1": clone("dorm_hireToRecAll_001#1", "dorm_hireToRecAll_002#1", "忠实拥趸"),
    "dorm_hireToRecAll_002#2": clone("dorm_hireToRecAll_001#2", "dorm_hireToRecAll_002#2", "忠实拥趸"),
  };
  const equip = (elite: number, replaces: string | null = null) => ({ unlock_elite: elite, unlock_level: 1, replaces });
  return {
    skills,
    operators: {
      "克莱门莎": ["meet_spd&cost_110#1", "meet_spd&cost_char_000#1"],
      "德·托莱多": ["hire_spd_cost_113#1", "hire_spd_cost_122#1", "dorm_hireToRecAll_002#1", "dorm_hireToRecAll_002#2"],
      // Recycling efficiency and workshop byproducts do not affect mood rates.
      "旅骨": [],
    },
    equips: {
      "克莱门莎": { "meet_spd&cost_110#1": equip(0), "meet_spd&cost_char_000#1": equip(2) },
      "德·托莱多": { "hire_spd_cost_113#1": equip(0), "hire_spd_cost_122#1": equip(2, "hire_spd_cost_113"), "dorm_hireToRecAll_002#1": equip(2), "dorm_hireToRecAll_002#2": equip(2) },
      "旅骨": {},
    },
  };
}
