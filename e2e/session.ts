import type { Page } from "@playwright/test";
import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import { SESSION_KEY, SESSION_VERSION } from "@riic/arknights-domain/persistence";

/**
 * 主会话在 localStorage 里的键名与结构版本只有一个来源：
 * `@riic/arknights-domain/persistence`。测试不要写字面量，
 * 否则换版本/改键名时要逐个文件改，且容易漏。
 */
export const sessionStorageKey = SESSION_KEY;

export type SessionSeedOverrides = Record<string, unknown>;

/** 一份完整可用的会话载荷；与生产 `persistSession` 写入的形状保持一致。 */
export function sessionPayload(overrides: SessionSeedOverrides = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    version: SESSION_VERSION,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    presetLabel: "243",
    layout: layout243,
    operbox: null,
    sourceName: null,
    boxSource: "sample",
    layoutDirty: false,
    layoutSource: "local",
    localLayoutBackup: null,
    rotationProfile: "abc_12_6_6",
    result: null,
    activeShift: 0,
    ...overrides,
  };
}

/** 在页面脚本执行前写入会话；`overrides` 覆盖 `sessionPayload` 的默认字段。 */
export async function seedSession(page: Page, overrides: SessionSeedOverrides = {}): Promise<void> {
  await page.addInitScript(([key, payload]) => {
    window.localStorage.setItem(key, JSON.stringify(payload));
  }, [SESSION_KEY, sessionPayload(overrides)] as const);
}

/** 读取当前会话（已解析）。测试里断言存储状态时用，避免重复写字面量。 */
export async function readSession(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SESSION_KEY);
}
