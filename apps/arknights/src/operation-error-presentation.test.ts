import "./i18n/test-setup.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { localizedOperationError } from "./operation-error-presentation.ts";

test("known task failures follow the display locale without changing task state", () => {
  const message = "任务已经开始计算，暂时无法取消；完成后仍会保留结果。";
  assert.equal(localizedOperationError(message, "zh-CN"), message);
  assert.match(localizedOperationError(message, "zh-TW"), /任務已開始/);
  assert.match(localizedOperationError(message, "en"), /cannot be cancelled/);
});
test("poster validation preserves identifiers and multiline diagnostics", () => {
  assert.equal(localizedOperationError("第 2 班的 阿米娅 重复入驻。\ntrade_1 的 AUTO 槽位重复。", "en"),
    "Shift 2 assigns 阿米娅 more than once.\ntrade_1 has duplicate AUTO slots.");
  assert.equal(localizedOperationError("upstream: custom diagnostic", "zh-TW"), "upstream: custom diagnostic");
});
