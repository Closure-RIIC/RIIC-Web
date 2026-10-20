import assert from "node:assert/strict";
import test from "node:test";
import { adminPreviewEnabled } from "./admin-preview-policy.ts";

test("admin preview requires both development and an explicit opt-in", () => {
  for (const NODE_ENV of [undefined, "production", "test", "development"]) {
    for (const ADMIN_UI_PREVIEW of [undefined, "0", "true", "1"]) {
      assert.equal(adminPreviewEnabled({ NODE_ENV, ADMIN_UI_PREVIEW }), NODE_ENV === "development" && ADMIN_UI_PREVIEW === "1");
    }
  }
});
