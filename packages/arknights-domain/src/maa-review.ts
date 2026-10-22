import { manualLevelFor, maxEliteForRarity } from './manual-operbox.ts';
import operatorRarities from './generated/arkntools/operator-rarities.json' with { type: 'json' };
import operatorCatalog from './generated/arkntools/operator-catalog.json' with { type: 'json' };

const RARITY_BY_NAME = new Map(operatorCatalog.map((operator) => [operator.name, operator.rarity]));

export function normalizeMaaRarities(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const canonicalId = id.startsWith('char_') ? id : `char_${id}`;
    const rarity = Object.hasOwn(operatorRarities, canonicalId)
      ? operatorRarities[canonicalId as keyof typeof operatorRarities]
      : RARITY_BY_NAME.get(String(row.name));
    return rarity === undefined ? row : { ...row, rarity };
  });
}

export type MaaChoice = { label: string; elite: number; level: number; own: boolean };
export type MaaIssue = { index: number; name: string; rarity: number; elite: number; level: number; choices: MaaChoice[] };
export function inspectMaaProgress(value: unknown): MaaIssue[] {
  value = normalizeMaaRarities(value);
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || row.own !== true) return [];
    const rarity = Number(row.rarity), elite = Number(row.elite), level = Number(row.level);
    if (!Number.isInteger(rarity) || rarity < 1 || rarity > 6) return [];
    const maxElite = maxEliteForRarity(rarity);
    if (Number.isInteger(elite) && elite >= 0 && elite <= maxElite && Number.isInteger(level) && level >= 1 && level <= manualLevelFor(rarity, elite)) return [];
    const choices: MaaChoice[] = [{ label: '未拥有', own: false, elite: 0, level: 1 }];
    if (rarity <= 2) choices.push({ label: '精0 非30级', own: true, elite: 0, level: 1 });
    for (let stage = 0; stage <= maxElite; stage++) {
      const cap = manualLevelFor(rarity, stage);
      const label = rarity <= 2 ? (stage === 0 ? "精0 30级" : "精0 非30级") : `精${stage}`;
      choices.push({ label, own: true, elite: stage, level: rarity <= 2 && stage === 0 ? cap : 1 });
    }
    if (Number.isInteger(level) && level >= 1 && level <= 90) {
      const inferred = Array.from({ length: maxElite + 1 }, (_, stage) => stage).find(stage => level <= manualLevelFor(rarity, stage));
      if (inferred !== undefined && inferred > elite && rarity >= 3) choices.splice(1, 0, { label: `精${inferred}（可能漏识别精英图标）`, own: true, elite: inferred, level: manualLevelFor(rarity, inferred) });
    }
    return [{ index, name: String(row.name ?? row.id), rarity, elite, level, choices }];
  });
}
