import data from "./catalog.json";
export { default as workbenchArtwork } from "./workbench.json";
export { compareOperatorRelease } from "./operator-releases";

export type DisplayOperator = (typeof data.operators)[keyof typeof data.operators];
export type DisplayWeapon = (typeof data.weapons)[keyof typeof data.weapons];
export const operators: Record<string, DisplayOperator> = data.operators;
export const weapons: Record<string, DisplayWeapon> = data.weapons;
const byName = new Map(Object.values(operators).flatMap(op => [[op.name, op], [op.enName, op]] as const));
export function operatorData(idOrName: string): DisplayOperator | undefined { return operators[idOrName] ?? byName.get(idOrName); }
export function weaponData(id: string): DisplayWeapon | undefined { return weapons[id]; }
