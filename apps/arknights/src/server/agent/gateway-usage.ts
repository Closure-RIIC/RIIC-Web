type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!tokenCount(value)) throw new Error("Invalid cache write token usage");
  return value;
}

// The SDK may not yet expose the gateway's Chat-compatible write counter.
// Missing upstream data stays unknown; only an explicitly measured zero is zero.
export function readRuntimeCacheWriteTokens(usage: unknown): number | undefined {
  const source = record(usage);
  if (!source) throw new Error("Invalid model token usage");
  const input = record(source.inputTokens);
  if (source.inputTokens !== undefined && !input) throw new Error("Invalid model input usage");
  const sdkWrite = optionalCount(input?.cacheWrite);
  const raw = record(source.raw);
  if (source.raw !== undefined && source.raw !== null && !raw) throw new Error("Invalid raw token usage");
  const details = record(raw?.prompt_tokens_details);
  if (raw?.prompt_tokens_details != null && !details) throw new Error("Invalid raw input token details");
  const rawWrite = optionalCount(details?.cache_write_tokens);
  if (sdkWrite !== undefined && rawWrite !== undefined && sdkWrite !== rawWrite) throw new Error("Conflicting cache write token usage");
  const write = sdkWrite ?? rawWrite;

  // Only the default 30-minute write price is supported. Do not flatten a
  // longer TTL into it if a future gateway/SDK preserves the upstream details.
  const ttlValue = details?.cache_write_tokens_details;
  if (ttlValue !== undefined) {
    const ttl = record(ttlValue);
    if (!ttl) throw new Error("Invalid cache write TTL usage");
    for (const [name, count] of Object.entries(ttl)) {
      if (!tokenCount(count)) throw new Error("Invalid cache write TTL usage");
      if (name !== "ttl_30m_tokens" && count !== 0) throw new Error("Unsupported cache write TTL usage");
      if (name === "ttl_30m_tokens" && (write === undefined || count !== write)) throw new Error("Conflicting cache write TTL usage");
    }
  }
  return write;
}

export type GatewayUsageCounts = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

// Magpie's ledger stores ordinary input separately. Its cache counters use
// omitempty, so their absence means zero, unlike missing upstream usage.
export function normalizeGatewayUsageCounts(value: unknown): GatewayUsageCounts | undefined {
  const row = record(value);
  if (!row) return undefined;
  const input = row.in;
  const output = row.out;
  const read = row.cache_read === undefined ? 0 : row.cache_read;
  const write = row.cache_write === undefined ? 0 : row.cache_write;
  const write1h = row.cache_write_1h === undefined ? 0 : row.cache_write_1h;
  if (!tokenCount(input) || !tokenCount(output) || !tokenCount(read) || !tokenCount(write) || !tokenCount(write1h) || write1h !== 0) return undefined;
  const total = input + read + write;
  // The application persists token counts in PostgreSQL integer columns.
  if (!Number.isSafeInteger(total) || total > 2_147_483_647 || output > 2_147_483_647) return undefined;
  return { inputTokens: total, outputTokens: output, cachedInputTokens: read, cacheWriteTokens: write };
}
