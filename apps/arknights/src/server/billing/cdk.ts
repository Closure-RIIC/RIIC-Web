import { createHash, randomBytes } from "node:crypto";

export class CdkValidationError extends Error {}

export function normalizeCdk(code: string): string {
  return code.trim().toUpperCase();
}

export function validCdk(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{7,63}$/.test(normalizeCdk(code));
}

export function hashCdk(code: string): string {
  return createHash("sha256").update(normalizeCdk(code)).digest("hex");
}

export function randomCdk(): string {
  return `RIIC-${randomBytes(18).toString("hex").toUpperCase()}`;
}

export const CDK_BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type AdminCdkInput = { batchId: string; count: number; points: number; codes?: string[]; batchLabel?: string; startsAt?: Date; expiresAt?: Date };

export function cdkAvailability(code: { status: string; startsAt?: Date | null; expiresAt?: Date | null }, now = new Date()) {
  if (code.status !== "issued") return code.status;
  if (code.expiresAt && code.expiresAt <= now) return "expired";
  if (code.startsAt && code.startsAt > now) return "scheduled";
  return "issued";
}

export function parseCdkRevocation(value: unknown): { id?: string; batchId?: string; reason: string } {
  if (!value || typeof value !== "object") throw new CdkValidationError("作废请求无效。");
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" && /^admin:[0-9a-f-]{36}:\d{1,3}$/.test(input.id) && CDK_BATCH_ID.test(input.id.split(":")[1]) ? input.id : undefined;
  const batchId = typeof input.batchId === "string" && CDK_BATCH_ID.test(input.batchId) ? input.batchId.toLowerCase() : undefined;
  if (Boolean(input.id) === Boolean(input.batchId) || (!id && !batchId)) throw new CdkValidationError("请选择一个活动码或一个批次。");
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 200) throw new CdkValidationError("请填写 1–200 字的作废原因。");
  return { ...(id ? { id } : { batchId }), reason: input.reason.trim() };
}

export function parseAdminCdkInput(value: unknown): AdminCdkInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CdkValidationError("请填写兑换码配置。");
  const input = value as Record<string, unknown>;
  if (typeof input.batchId !== "string" || !CDK_BATCH_ID.test(input.batchId)) {
    throw new CdkValidationError("批次编号无效，请刷新页面后重试。");
  }
  if (typeof input.count !== "number" || !Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
    throw new CdkValidationError("每批兑换码数量须为 1–100 个。");
  }
  if (typeof input.points !== "number" || !Number.isInteger(input.points) || input.points < 1 || input.points > 100_000) {
    throw new CdkValidationError("每个兑换码的积分须为 1–100000 的整数。");
  }
  let codes: string[] | undefined;
  if (input.codes !== undefined) {
    if (!Array.isArray(input.codes) || input.codes.length !== input.count || input.codes.some(code => typeof code !== "string" || !validCdk(code))) {
      throw new CdkValidationError("自定义码数量须与生成数量一致，每个码为 8–64 位英文字母、数字、短横线或下划线。");
    }
    codes = input.codes.map(code => normalizeCdk(code as string));
    if (new Set(codes).size !== codes.length) throw new CdkValidationError("自定义兑换码不能重复（不区分大小写）。");
  }
  if (input.batchLabel !== undefined && (typeof input.batchLabel !== "string" || input.batchLabel.trim().length > 80)) throw new CdkValidationError("批次名称最多 80 字。");
  const dates: { startsAt?: Date; expiresAt?: Date } = {};
  for (const key of ["startsAt", "expiresAt"] as const) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new CdkValidationError("有效期须为包含时区的日期时间。");
    dates[key] = new Date(value);
  }
  if (dates.expiresAt && dates.expiresAt.getTime() <= Math.max(Date.now(), dates.startsAt?.getTime() ?? 0)) throw new CdkValidationError("到期时间须晚于当前时间和启用时间。");
  return { batchId: input.batchId.toLowerCase(), count: input.count, points: input.points, ...(codes ? { codes } : {}), ...(typeof input.batchLabel === "string" && input.batchLabel.trim() ? { batchLabel: input.batchLabel.trim() } : {}), ...dates };
}
