import assert from "node:assert/strict";
import test from "node:test";

import sourceManifest from "./generated/arkntools/source.json" with { type: "json" };
import { ALL_PRODUCT_ICON_URLS, PRODUCT_ICON_URLS } from "./product-assets.ts";

test("builds deterministic versioned product URLs from each managed upstream source", () => {
  const arkntoolsVersion = `${sourceManifest.version}-${sourceManifest.source.commit.slice(0, 12)}`;
  const gameResourceVersion = `${sourceManifest.version}-${sourceManifest.portraitsSource.commit.slice(0, 12)}`;

  assert.equal(PRODUCT_ICON_URLS.lmdOrders, `/images/products/lmd_orders.webp?v=${arkntoolsVersion}`);
  assert.equal(PRODUCT_ICON_URLS.experience, `/images/products/experience.webp?v=${arkntoolsVersion}`);
  assert.equal(PRODUCT_ICON_URLS.gold, `/images/products/gold.webp?v=${gameResourceVersion}`);
  assert.equal(PRODUCT_ICON_URLS.shards, `/images/products/originium_shard.webp?v=${gameResourceVersion}`);
  assert.equal(PRODUCT_ICON_URLS.orundum, `/images/products/orundum.webp?v=${gameResourceVersion}`);
  assert.equal(PRODUCT_ICON_URLS.drone, `/images/products/drone.webp?v=${gameResourceVersion}`);
  assert.equal(ALL_PRODUCT_ICON_URLS.length, 6);
  assert.equal(new Set(ALL_PRODUCT_ICON_URLS).size, 6);
  for (const url of ALL_PRODUCT_ICON_URLS) {
    assert.match(url, /^\/images\/products\/[a-z_]+\.webp\?v=\d+-[0-9a-f]{12}$/);
  }
});
