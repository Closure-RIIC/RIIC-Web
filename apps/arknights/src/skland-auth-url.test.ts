import assert from "node:assert/strict";
import test from "node:test";

import { buildSklandAppOpenUrl } from "../../../packages/platform/skland-auth-url.ts";

test("builds the official universal link for opening the Skland app", () => {
  assert.equal(
    buildSklandAppOpenUrl(),
    "https://bbs.hycdn.cn/u-link/download.html?schema=skland%3A%2F%2FgameCenter"
  );
});
