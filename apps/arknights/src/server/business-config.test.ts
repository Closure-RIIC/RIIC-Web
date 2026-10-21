import assert from "node:assert/strict";
import test from "node:test";

import { workspaceMasterKeys } from "./business-config.ts";

test("workspace master keys require an explicit base64 prefix", () => {
  const previousVersion = process.env.WORKSPACE_ACTIVE_KEY_VERSION;
  const previousKeys = process.env.WORKSPACE_MASTER_KEYS;
  const key = Buffer.alloc(32, 13);

  try {
    process.env.WORKSPACE_ACTIVE_KEY_VERSION = "integration";
    process.env.WORKSPACE_MASTER_KEYS = JSON.stringify({
      integration: `base64:${key.toString("base64")}`,
    });
    assert.deepEqual(workspaceMasterKeys().keys.get("integration"), key);

    process.env.WORKSPACE_MASTER_KEYS = JSON.stringify({
      integration: key.toString("base64"),
    });
    assert.throws(() => workspaceMasterKeys(), /must decode to exactly 32 bytes/);
  } finally {
    if (previousVersion === undefined) delete process.env.WORKSPACE_ACTIVE_KEY_VERSION;
    else process.env.WORKSPACE_ACTIVE_KEY_VERSION = previousVersion;
    if (previousKeys === undefined) delete process.env.WORKSPACE_MASTER_KEYS;
    else process.env.WORKSPACE_MASTER_KEYS = previousKeys;
  }
});
