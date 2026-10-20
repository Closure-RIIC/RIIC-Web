import type { OperBoxEntry } from "./types.ts";
import { normalizeOperboxEntries } from "./operbox-normalization.ts";
import { manualLevelFor, maxEliteForRarity } from "./manual-operbox.ts";
import operatorRarities from "./generated/arkntools/operator-rarities.json" with { type: "json" };

function pickValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in row && row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
}

function boolValue(value: unknown): boolean {
  if (value === false) return false;
  if (typeof value === "string" && value.toLowerCase() === "false")
    return false;
  if (typeof value === "number" && value === 0) return false;
  return true;
}

function numberValue(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function assertOperbox(value: unknown): OperBoxEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("练度 JSON 需要是非空数组。");
  }
  const seen = new Set<string>();
  const entries = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`第 ${index + 1} 项不是有效的干员对象。`);
    }
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const elite = Number(row.elite);
    const level = Number(row.level);
    const potential = Number(row.potential);
    const rarity = Number(row.rarity);
    if (!id || !name) throw new Error(`第 ${index + 1} 项缺少 id 或 name。`);
    if (seen.has(id)) throw new Error(`干员 id ${id} 重复。`);
    if (typeof row.own !== "boolean")
      throw new Error(`${name} 的 own 必须是布尔值。`);
    const owned = row.own as boolean;
    if (owned) {
      if (!Number.isInteger(elite) || elite < 0 || elite > 2)
        throw new Error(`${name} 的 elite 必须是 0–2 的整数。`);
      if (!Number.isInteger(level) || level < 1 || level > 90)
        throw new Error(`${name} 的 level 必须是 1–90 的整数。`);
      if (!Number.isInteger(potential) || potential < 1 || potential > 6)
        throw new Error(`${name} 的 potential 必须是 1–6 的整数。`);
    }
    if (!Number.isInteger(rarity) || rarity < 1 || rarity > 6)
      throw new Error(`${name} 的 rarity 必须是 1–6 的整数。`);
    const canonicalId = id.startsWith("char_") ? id : `char_${id}`;
    const canonicalRarity = Object.hasOwn(operatorRarities, canonicalId)
      ? operatorRarities[canonicalId as keyof typeof operatorRarities] : undefined;
    if (canonicalRarity !== undefined && rarity !== canonicalRarity)
      throw new Error(`${name} 的 rarity 必须与干员数据一致（${canonicalRarity} 星）。`);
    const validatedRarity = rarity;
    if (owned) {
      const maxElite = maxEliteForRarity(validatedRarity);
      if (elite > maxElite)
        throw new Error(`${name}（${rarity} 星）的 elite 不能超过 ${maxElite}。`);
      const maxLevel = manualLevelFor(validatedRarity, elite);
      if (level > maxLevel)
        throw new Error(`${name}（${rarity} 星、精英 ${elite}）的 level 不能超过 ${maxLevel}。`);
    }
    seen.add(id);
    return { id, name, elite, level, own: row.own, potential, rarity: validatedRarity };
  });
  return normalizeOperboxEntries(entries);
}

async function normalizeImportedEntries(entries: readonly OperBoxEntry[]): Promise<OperBoxEntry[]> {
  const { normalizeImportedOperboxEntries } = await import("./operator-name-normalization.ts");
  return normalizeImportedOperboxEntries(entries);
}

export async function readOperboxText(text: string): Promise<OperBoxEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "MAA JSON 无法解析，请确认粘贴了完整的 Arknights_OperBox_Export.json 内容。",
    );
  }
  const { normalizeMaaRarities } = await import("./maa-review.ts");
  parsed = normalizeMaaRarities(parsed);
  if (Array.isArray(parsed)) {
    parsed = parsed.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return row;
      const value = row as Record<string, unknown>;
      const normalizedRarity = Number(value.rarity);
      const elite = Number(value.elite);
      if (value.own !== true || !Number.isInteger(normalizedRarity) || normalizedRarity < 1 || normalizedRarity > 6) return row;
      if (Number.isInteger(elite) && elite > maxEliteForRarity(normalizedRarity)) {
        const safeElite = maxEliteForRarity(normalizedRarity);
        return { ...value, rarity: normalizedRarity, elite: safeElite, level: manualLevelFor(normalizedRarity, safeElite) };
      }
      if (Number.isInteger(elite) && Number.isFinite(Number(value.level))) {
        return { ...value, rarity: normalizedRarity, level: Math.min(Number(value.level), manualLevelFor(normalizedRarity, elite)) };
      }
      return row;
    });
  }
  return normalizeImportedEntries(assertOperbox(parsed));
}

type XlsxModule = typeof import("xlsx");

export async function readOperboxFile(
  file: File,
  loadXlsx: () => Promise<XlsxModule> = () => import("xlsx"),
): Promise<OperBoxEntry[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await loadXlsx();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    return normalizeImportedEntries(assertOperbox(
      rows
        .filter((row) => pickValue(row, ["name", "id", "干员", "干员名称"]))
        .map((row) => {
          const name = String(
            pickValue(row, ["name", "干员名称", "干员", "名称", "id"]) ?? "",
          );
          return {
            id: String(
              pickValue(row, ["id", "char_id", "干员ID", "干员编号"]) ?? name,
            ),
            name,
            elite: numberValue(
              pickValue(row, ["elite", "精英化等级", "精英化", "精英"]),
              0,
            ),
            level: numberValue(
              pickValue(row, ["level", "等级", "当前等级"]),
              1,
            ),
            own: boolValue(pickValue(row, ["own", "拥有", "是否已招募"])),
            potential: numberValue(
              pickValue(row, ["potential", "潜能等级", "潜能"]),
              1,
            ),
            rarity: numberValue(
              pickValue(row, ["rarity", "星级", "稀有度"]),
              1,
            ),
          };
        }),
    ));
  }

  return readOperboxText(await file.text());
}

export function countOwned(operbox: OperBoxEntry[] | null): number {
  return operbox?.filter((entry) => entry.own).length ?? 0;
}

export function countElite2(operbox: OperBoxEntry[] | null): number {
  return operbox?.filter((entry) => entry.own && entry.elite >= 2).length ?? 0;
}

export function countSixStar(operbox: OperBoxEntry[] | null): number {
  return operbox?.filter((entry) => entry.own && entry.rarity >= 6).length ?? 0;
}
