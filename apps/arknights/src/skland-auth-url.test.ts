import assert from "node:assert/strict";
import test from "node:test";

import { buildSklandAppOpenUrl } from "@riic/platform/skland-auth-url";

test("builds the official universal link for opening the Skland app", () => {
  assert.equal(
    buildSklandAppOpenUrl(),
    "https://bbs.hycdn.cn/u-link/download.html?schema=skland%3A%2F%2FgameCenter"
  );
});
