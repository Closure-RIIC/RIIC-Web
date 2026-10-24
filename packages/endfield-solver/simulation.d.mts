export interface SkillEffect {
  room: "中枢" | "制造舱" | "培养舱" | "会客室";
  kind: "减免" | "恢复" | "加成";
  cat?: string;
  value: number;
  tier?: string;
  unlock: number;
  nodeId?: string;
  slot?: number | null;
  level?: number | null;
}

export interface SimulationOperator {
  name?: string;
  elite?: number;
  latestSpaceshipSkillNodes?: string[];
}

export const MFG_LAYOUTS: Record<string, string[]>;

export const SIM_RATES: {
  work: number;
  rest: number;
  head: number;
  assist: number;
  slots: number;
  centerCapHours: number;
};

export function operatorEffects(operator: SimulationOperator): SkillEffect[];
export function hasShipSkills(name: string): boolean;
