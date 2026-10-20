type JsonRecord = Record<string, unknown>;

function isObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recoveredShift(roomLines: JsonRecord[], index: number) {
  return {
    index,
    duration_hours: index === 0 ? 12 : 6,
    active_teams: [],
    resting_team: "",
    scores: { trade_score: 0, manu_prod_sum: 0, power_charge_sum: 0, room_lines: roomLines },
    weighted_trade: 0,
    weighted_manu: 0,
    weighted_power: 0,
  };
}

function roomLinesFromParsed(value: unknown): JsonRecord[] {
  if (!isObject(value) || !Array.isArray(value.rooms)) return [];
  return value.rooms.flatMap((room) => {
    if (!isObject(room) || typeof room.room_id !== "string" || !isObject(room.efficiency)) return [];
    return [{ room_id: room.room_id, ...room.efficiency }];
  });
}

function roomLinesFromDamagedText(raw: string): JsonRecord[] {
  const matches = [...raw.matchAll(/"room_id"\s*:\s*"([^"]+)"/g)];
  return matches.flatMap((match, index) => {
    const segment = raw.slice(match.index, matches[index + 1]?.index);
    const block = segment.match(/"efficiency"\s*:\s*\{([\s\S]*?)\}/)?.[1];
    if (!block) return [];
    const efficiency = Object.fromEntries(
      [...block.matchAll(/"([a-z_]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g)].map(([, key, value]) => [key, Number(value)])
    );
    return Object.keys(efficiency).length ? [{ room_id: match[1], ...efficiency }] : [];
  });
}

export function parseShiftFile(raw: string, index: number): unknown | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isObject(parsed) && isObject(parsed.scores) && Array.isArray(parsed.scores.room_lines)) return parsed;
    const roomLines = roomLinesFromParsed(parsed);
    return roomLines.length ? recoveredShift(roomLines, index) : null;
  } catch {
    const roomLines = roomLinesFromDamagedText(raw);
    return roomLines.length ? recoveredShift(roomLines, index) : null;
  }
}
