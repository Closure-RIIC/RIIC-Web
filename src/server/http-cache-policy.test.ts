import assert from "node:assert/strict";
import test from "node:test";
import { assetCacheControl, IMMUTABLE_CACHE_CONTROL } from "./http-cache-policy.ts";

test("mutable game assets require a complete version before they can be cached immutably", () => {
  for (const directory of ["products", "building-skills", "operator-portraits"]) {
    const base = "https://example.test/images/" + directory + "/asset.png";
    assert.equal(assetCacheControl(new URL(base)), undefined);
    for (const value of ["", "123", "123-abcdef", "123-abcdef123456-extra"]) {
      assert.equal(assetCacheControl(new URL(base + "?v=" + value)), undefined);
    }
    assert.equal(assetCacheControl(new URL(base + "?v=123-abcdef123456")), IMMUTABLE_CACHE_CONTROL);
  }
});
test("only explicitly immutable asset families receive the long cache lifetime", () => {
  for (const pathname of ["/assets/app-hash.js", "/images/ui/icon.png", "/images/elite/2.png"]) {
    assert.equal(assetCacheControl(new URL("https://example.test" + pathname)), IMMUTABLE_CACHE_CONTROL);
  }
  for (const pathname of ["/", "/admin", "/api/auth/get-session", "/images/products/sub/asset.png?v=123-abcdef123456"]) {
    assert.equal(assetCacheControl(new URL("https://example.test" + pathname)), undefined);
  }
});
