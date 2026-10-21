import operatorCatalogJson from "./generated/arkntools/operator-catalog.json" with { type: "json" };

export interface OperatorBuildingSkillRef {
  index: number;
  id: string;
  elite: number;
  level: number;
}

export interface OperatorAssetRecord {
  id: string;
  name: string;
  /** 数据仓库 building.json char 字段中的原始顺序，用于默认倒序展示。 */
  order: number;
  rarity: number;
  profession: number;
  position: number;
  portrait: string;
  buildingSkills: OperatorBuildingSkillRef[];
}

const OPERATOR_NAME_ALIASES: Readonly<Record<string, string>> = {
  "阿米娅(近卫)": "char_002_amiya",
  "阿米娅(医疗)": "char_002_amiya",
};

export const OPERATOR_CATALOG = operatorCatalogJson as OperatorAssetRecord[];
const OPERATOR_BY_ID = new Map(OPERATOR_CATALOG.map((operator) => [operator.id, operator]));
const OPERATOR_BY_NAME = new Map(OPERATOR_CATALOG.map((operator) => [operator.name, operator]));

/** Resolve identity and filter metadata without loading building-skill descriptions. */
export function operatorFor(name: string, id?: string): OperatorAssetRecord | undefined {
  const normalizedId = id?.trim();
  if (normalizedId) {
    const byId = OPERATOR_BY_ID.get(normalizedId) ?? OPERATOR_BY_ID.get(`char_${normalizedId}`);
    if (byId) return byId;
  }
  const normalizedName = name.trim();
  const aliasId = OPERATOR_NAME_ALIASES[normalizedName];
  return (aliasId ? OPERATOR_BY_ID.get(aliasId) : undefined) ?? OPERATOR_BY_NAME.get(normalizedName);
}
