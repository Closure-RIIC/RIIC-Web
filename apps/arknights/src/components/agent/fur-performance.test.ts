import assert from "node:assert/strict";
import test from "node:test";
import { agentFurSettings, galleryFurSettings, type FurSettings } from "./fur-settings.ts";
import { normalizeFurPerformanceMode, performanceSettings, resolvePerformanceTier, type FurPerformanceTier } from "./fur-performance.ts";

test("invalid browser preferences select automatic quality safely", () => {
  for (const input of [null, undefined, "", "fast", "QUALITY", 3, {}, { mode: "static" }]) {
    assert.equal(normalizeFurPerformanceMode(input), "auto");
  }
  for (const mode of ["auto", "quality", "balanced", "saver", "static"] as const) {
    assert.equal(normalizeFurPerformanceMode(mode), mode);
  }
});

test("automatic startup protects software renderers without overriding explicit choices", () => {
  assert.equal(resolvePerformanceTier("auto", true), "saver");
  assert.equal(resolvePerformanceTier("auto", false), "quality");
  for (const tier of ["quality", "balanced", "saver", "static"] as const) {
    assert.equal(resolvePerformanceTier(tier, true), tier);
    assert.equal(resolvePerformanceTier(tier, false), tier);
  }
});

test("every budget preserves the complete authored appearance and original settings", () => {
  const authored = Object.freeze(galleryFurSettings({ length: 1.8, density: 2.3, curl: 3.1, yaw: 38, pitch: -12, zoom: 1.2, eyeRoughness: 0.7 }));
  const appearanceKeys = (Object.keys(authored) as (keyof FurSettings)[]).filter(key => !["shells", "resolution", "fps"].includes(key));
  for (const tier of ["quality", "balanced", "saver", "static"] satisfies FurPerformanceTier[]) {
    for (const surface of ["gallery", "chat", "portrait"] as const) {
      const result = performanceSettings(authored, tier, surface === "gallery", surface === "portrait" ? "portrait" : "chat");
      for (const key of appearanceKeys) assert.equal(result[key], authored[key], `${tier}: ${key}`);
      assert.notEqual(result, authored);
    }
  }
  assert.deepEqual(performanceSettings(authored, "quality", true), authored);
});

test("lower quality reduces the budget monotonically on gallery and avatar surfaces", () => {
  for (const surface of ["gallery", "chat", "portrait"] as const) {
    const gallery = surface === "gallery";
    const agentSurface = surface === "portrait" ? "portrait" : "chat";
    const original = gallery ? galleryFurSettings({}) : agentFurSettings({}, agentSurface);
    const balanced = performanceSettings(original, "balanced", gallery, agentSurface);
    const saver = performanceSettings(original, "saver", gallery, agentSurface);
    for (const key of ["shells", "resolution", "fps"] as const) {
      assert.ok(balanced[key] <= original[key], `balanced must not increase ${key}`);
      assert.ok(saver[key] <= balanced[key], `saver must not increase ${key}`);
    }
    assert.ok(saver.shells < original.shells);
    assert.ok(balanced.resolution < original.resolution);
  }
});
