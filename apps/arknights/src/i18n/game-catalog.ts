export type GameCatalog = {
  roomLabels: Record<string, string>;
  operatorNames: Record<string, string>;
  buildingSkills: Record<string, { name: string; description: string }>;
  itemNames: Record<string, string>;
};
