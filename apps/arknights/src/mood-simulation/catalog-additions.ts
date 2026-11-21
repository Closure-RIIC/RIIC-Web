import type { Skill } from "./rules.ts";

// New operators absent from the pinned reference. Values and unlock levels follow
// packages/arknights-domain/src/generated/arkntools/*.json (arkntools 979536f);
// elite-2 upgrades use the same replaces convention as the reference catalog.
// Define every field explicitly: cloning another skill would inherit unrelated
// basis/note/partial_mode data.
type AdditionSpec = Pick<Skill, "id" | "name" | "kind" | "value" | "facility_types" | "template_id"> &
  Partial<Pick<Skill, "condition" | "basis">>;

const skill = (spec: AdditionSpec): Skill => ({
  target_faction: null,
  condition: null,
  exclusive: false,
  pool: false,
  untranslated: false,
  count_faction: null,
  max_group: null,
  spread_whitelist: false,
  var_name: null,
  var_per: null,
  var_min: null,
  basis: null,
  self_only: false,
  boost_provider: null,
  boost_group: null,
  ...spec,
});

export function moodCatalogAdditions() {
  const skills = {
    "meet_spd&cost_110#1": skill({
      id: "meet_spd&cost_110#1", name: "谈判技巧", kind: "self_consume", value: "1",
      facility_types: ["reception"], template_id: "M07a",
    }),
    "meet_spd&cost_char_000#1": skill({
      id: "meet_spd&cost_char_000#1", name: "合作原则", kind: "self_consume", value: "1",
      facility_types: ["reception"], template_id: "M07a",
      condition: { name: "_cond_with_other_operator", args: [] },
    }),
    "hire_spd_cost_113#1": skill({
      id: "hire_spd_cost_113#1", name: "拉拢听众", kind: "self_consume", value: "-0.25",
      facility_types: ["office"], template_id: "M07a",
    }),
    "hire_spd_cost_122#1": skill({
      id: "hire_spd_cost_122#1", name: "聚众宣讲", kind: "self_consume", value: "-0.25",
      facility_types: ["office"], template_id: "M07a",
    }),
    "dorm_hireToRecAll_002#1": skill({
      id: "dorm_hireToRecAll_002#1", name: "忠实拥趸", kind: "dorm_group", value: "0.1",
      facility_types: [], template_id: "M08",
    }),
    "dorm_hireToRecAll_002#2": skill({
      id: "dorm_hireToRecAll_002#2", name: "忠实拥趸", kind: "dorm_group", value: "0.05",
      facility_types: [], template_id: "M08", basis: "recruit_slot",
    }),
    "recycle_spd&cost_100#1": skill({
      id: "recycle_spd&cost_100#1", name: "无差别回收", kind: "self_consume", value: "-0.1",
      facility_types: ["recycle"], template_id: "M07a",
    }),
    "recycle_spd&cost_110#1": skill({
      id: "recycle_spd&cost_110#1", name: "无差别转化", kind: "self_consume", value: "-0.1",
      facility_types: ["recycle"], template_id: "M07a",
    }),
    "dorm_rec_all&unfull_100#1": skill({
      id: "dorm_rec_all&unfull_100#1", name: "微小的帮助", kind: "dorm_group", value: "0.1",
      facility_types: [], template_id: "M08",
    }),
    "dorm_rec_all&unfull_100#2": skill({
      id: "dorm_rec_all&unfull_100#2", name: "微小的帮助", kind: "dorm_group", value: "0.01",
      facility_types: [], template_id: "M08", basis: "dorm_unfull",
    }),
  };
  const equip = (elite: number, replaces: string | null = null) => ({ unlock_elite: elite, unlock_level: 1, replaces });
  return {
    skills,
    operators: {
      "克莱门莎": ["meet_spd&cost_110#1", "meet_spd&cost_char_000#1"],
      "德·托莱多": ["hire_spd_cost_113#1", "hire_spd_cost_122#1", "dorm_hireToRecAll_002#1", "dorm_hireToRecAll_002#2"],
      // Recycling efficiency and workshop byproducts do not affect mood rates.
      "旅骨": [],
      "国度": ["recycle_spd&cost_100#1", "recycle_spd&cost_110#1"],
      "冻河": ["dorm_rec_all&unfull_100#1", "dorm_rec_all&unfull_100#2"],
      // No mood-relevant building skills; registered so assigned operators do not fail.
      "镜匠": [],
      "行铃": [],
      "奥尔佳": [],
      "塔露拉": [],
    },
    equips: {
      "克莱门莎": { "meet_spd&cost_110#1": equip(0), "meet_spd&cost_char_000#1": equip(2) },
      "德·托莱多": { "hire_spd_cost_113#1": equip(0), "hire_spd_cost_122#1": equip(2, "hire_spd_cost_113"), "dorm_hireToRecAll_002#1": equip(2), "dorm_hireToRecAll_002#2": equip(2) },
      "旅骨": {},
      "国度": { "recycle_spd&cost_100#1": equip(0), "recycle_spd&cost_110#1": equip(2, "recycle_spd&cost_100") },
      "冻河": { "dorm_rec_all&unfull_100#1": equip(0), "dorm_rec_all&unfull_100#2": equip(0) },
      "镜匠": {},
      "行铃": {},
      "奥尔佳": {},
      "塔露拉": {},
    },
  };
}
