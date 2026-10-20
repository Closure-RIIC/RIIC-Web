import type { ReleaseDraft, ReleaseSection, ReleaseText } from "./types.ts";

export const RELEASE_KINDS = ["added", "improved", "fixed"] as const;
export const RELEASE_LIMITS = { title: 120, item: 500, itemsPerSection: 12, bodyBytes: 128 * 1024 } as const;
export const RELEASE_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export class ReleaseValidationError extends Error {}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw new ReleaseValidationError("更新日志格式不正确。");
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string") throw new ReleaseValidationError("请填写有效的文本内容。");
  const trimmed = value.trim();
  const hasControl = [...trimmed].some((char) => char.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(char));
  if ((required && !trimmed) || trimmed.length > max || hasControl) {
    throw new ReleaseValidationError(`文本不能为空，且不能超过 ${max} 字。`);
  }
  return trimmed;
}

function localized(value: unknown, max: number): ReleaseText {
  const record = object(value, ["zh", "en"]);
  return { zh: text(record.zh, max), en: text(record.en ?? "", max, false) };
}

export function parseReleaseDraft(value: unknown): ReleaseDraft {
  const record = object(value, ["version", "date", "title", "sections", "notify"]);
  const version = text(record.version, 20);
  if (!RELEASE_VERSION.test(version)) throw new ReleaseValidationError("版本号请使用 0.6.1 这样的三段数字，且不要加 v。");
  const date = text(record.date, 10);
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date) throw new ReleaseValidationError("请填写有效的发布日期。");
  if (typeof record.notify !== "boolean") throw new ReleaseValidationError("请选择是否弹窗通知。");
  if (!Array.isArray(record.sections) || !record.sections.length || record.sections.length > 3) {
    throw new ReleaseValidationError("请至少填写一条更新内容。");
  }
  const kinds = new Set<string>();
  const sections: ReleaseSection[] = record.sections.map((value) => {
    const section = object(value, ["kind", "items"]);
    const kind = RELEASE_KINDS.find((candidate) => candidate === section.kind);
    if (!kind || kinds.has(kind)) throw new ReleaseValidationError("更新分类不可重复。");
    kinds.add(kind);
    if (!Array.isArray(section.items) || !section.items.length || section.items.length > RELEASE_LIMITS.itemsPerSection) {
      throw new ReleaseValidationError(`每个分类需包含 1–${RELEASE_LIMITS.itemsPerSection} 条内容。`);
    }
    return { kind, items: section.items.map((item) => localized(item, RELEASE_LIMITS.item)) };
  });
  return { version, date, title: localized(record.title, RELEASE_LIMITS.title), sections, notify: record.notify };
}

export function compareReleaseVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function assertReleasePublishable(draft: ReleaseDraft, now = new Date()): void {
  const shanghaiDate = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (draft.date > shanghaiDate) throw new ReleaseValidationError("发布日期尚未到来，请先保存草稿，功能上线后再发布。");
}

export function parseReleaseMutation(value: unknown): { action: "save" | "publish" | "withdraw" | "delete"; revision: number; draft?: ReleaseDraft } {
  const record = object(value, ["action", "revision", "draft"]);
  const action = ["save", "publish", "withdraw", "delete"].find((candidate) => candidate === record.action) as "save" | "publish" | "withdraw" | "delete" | undefined;
  if (!action || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
    throw new ReleaseValidationError("操作或草稿修订号无效，请刷新后重试。");
  }
  if (action !== "save" && record.draft !== undefined) throw new ReleaseValidationError("请先保存草稿，再执行发布操作。");
  return { action, revision: Number(record.revision), ...(action === "save" ? { draft: parseReleaseDraft(record.draft) } : {}) };
}
