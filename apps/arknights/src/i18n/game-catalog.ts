import operatorEnglishNamesJson from "../generated/operator-english-names.json" with { type: "json" };
import buildingSkillEnglishJson from "../generated/building-skill-english.json" with { type: "json" };
import buildingSkillEnglishManualJson from "../generated/building-skill-english-manual.json" with { type: "json" };

type BuildingSkillEnglish = Record<string, { name: string; description: string }>;

export const ENGLISH_CATALOG = {
  roomLabels: {
    control: "Control Center",
    trading: "Trading Post",
    manufacture: "Factory",
    power: "Power Plant",
    dormitory: "Dormitory",
    meeting: "Reception Room",
    hire: "Office",
    processing: "Workshop",
    training: "Training Room",
    recycling: "Recycling Station",
  } as Record<string, string>,
  operatorNames: {
    ...(operatorEnglishNamesJson as Record<string, string>),
    "予愿安洁莉娜": "Angelina the Wishful",
    "焰狐龙梓兰": "Flaming Espinas Orchid",
    "雷狼龙S空爆": "Zinogre S Catapult",
    "怒潮凛冬": "Raging Tide Zima",
    "凯尔希·思衡托": "Kal'tsit Sincero",
    "罗德岛隐秘队": "Rhodes Island Covert Team",
    "伯塔尼": "Botany",
    "乌啾": "Ujou",
    "裂响": "Tanya",
    "维伊": "Veen",
    "GALLUS²": "GALLUS²",
    "可露希尔": "Closure",
    "谬因": "Aphris",
    "机械师": "McNist",
    "佩德洛": "Pedro",
    "珊比": "Thumpy",
    "时隙": "Timeslot",
    "嘉辛塔": "Jacinta",
  } as Record<string, string>,
  buildingSkills: {
    ...(buildingSkillEnglishJson as BuildingSkillEnglish),
    ...(buildingSkillEnglishManualJson as BuildingSkillEnglish),
  },
};

export type EnglishCatalog = typeof ENGLISH_CATALOG;
