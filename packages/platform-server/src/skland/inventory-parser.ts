export function inventoryItemsFromResponse(data: unknown): Array<{ id: string; count: number }> {
  const byId = new Map<string, number>();
  const seen = new WeakSet<object>();

  const add = (idValue: unknown, countValue: unknown) => {
    const id = String(idValue ?? "").trim();
    const count = Number(countValue);
    if (!/^\d+$/.test(id) || !Number.isFinite(count) || count < 0) return;
    byId.set(id, Math.max(byId.get(id) ?? 0, Math.floor(count)));
  };

  const idFromType = (value: unknown): string | null => {
    const type = String(value ?? "").trim().toUpperCase();
    if (["DIAMOND_SHD", "ORUNDUM", "ORUNDUM_SHD"].includes(type)) return "4003";
    if (["DIAMOND", "ORIGINITE", "ORIGINITE_PRIME", "PURE_ORIGINIUM"].includes(type)) return "4002";
    if (["GOLD", "LMD", "DRAGON_COINS", "DRAGONCOINS"].includes(type)) return "4001";
    return null;
  };

  const numberFrom = (record: Record<string, unknown>, keys: string[]): number | null => {
    for (const key of keys) {
      const value = record[key];
      const number = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
          ? Number(value)
          : null;
      if (number !== null && Number.isFinite(number)) return number;
    }
    return null;
  };

  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    const recordId = record.id
      ?? record.itemId
      ?? record.resourceId
      ?? record.item_id
      ?? record.resource_id
      ?? idFromType(record.type ?? record.itemType ?? record.resourceType);
    const recordCount = numberFrom(record, ["count", "amount", "quantity", "num", "value", "total"]);
    if (recordId !== undefined && recordCount !== null) add(recordId, recordCount);
    for (const [key, child] of Object.entries(record)) {
      const numericChild = typeof child === "number"
        ? child
        : typeof child === "string" && child.trim() && Number.isFinite(Number(child))
          ? Number(child)
          : null;
      if (numericChild !== null) {
        if (/^\d+$/.test(key)) add(key, numericChild);
        if (/^(?:gold|lmd|dragonCoins|dragon_coins|orundum|合成玉)$/i.test(key)) add(
          /^(?:orundum|合成玉)$/i.test(key) ? "4003" : "4001",
          numericChild,
        );
        if (/^(?:originium|pureOriginium|originitePrime|originite_prime|至纯源石|原石)$/i.test(key)) add("4002", numericChild);
      } else {
        visit(child, depth + 1);
      }
    }
  };

  visit(data, 0);
  return [...byId.entries()].map(([id, count]) => ({ id, count }));
}
