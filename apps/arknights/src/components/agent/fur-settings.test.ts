import assert from "node:assert/strict";
import test from "node:test";
import { agentFurSettings, galleryFurSettings, savedFurSettings, DEFAULT_FUR_SETTINGS, FUR_PRESETS, normalizeFurSettings } from "./fur-settings.ts";

test("invalid or old settings fall back to the authored avatar defaults", () => {
  assert.deepEqual(normalizeFurSettings(null), DEFAULT_FUR_SETTINGS);
  assert.deepEqual(normalizeFurSettings({ shells: NaN, density: "4", zoom: Infinity }), DEFAULT_FUR_SETTINGS);
});

test("imported settings cannot allocate excessive shells, resolution or frame rate", () => {
  const settings = normalizeFurSettings({ shells: 1e9, resolution: 1e9, fps: 1000, thickness: -1, yaw: -999, arbitrary: "discard" });
  assert.equal(settings.shells, 64);
  assert.equal(settings.resolution, 1.5);
  assert.equal(settings.fps, 60);
  assert.equal(settings.thickness, 0.25);
  assert.equal(settings.yaw, -180);
  assert.ok(!("arbitrary" in settings));
  assert.equal(normalizeFurSettings({ shells: 20.6 }).shells, 21);
});

test("all quality presets stay within the renderer limits", () => {
  for (const preset of Object.values(FUR_PRESETS)) assert.deepEqual(normalizeFurSettings(preset), preset);
  assert.equal(DEFAULT_FUR_SETTINGS.shells, 28);
});

test("Agent keeps the saved appearance without inheriting gallery rendering cost", () => {
  const saved = { ...FUR_PRESETS.fine, length: 1.7, density: 2.3, yaw: 21, brightness: 1.4, eyeRoughness: 0.6, fps: 60 };
  const original = { ...saved };
  const agent = agentFurSettings(saved), portrait = agentFurSettings(saved, "portrait"), gallery = galleryFurSettings(agent);
  for (const key of Object.keys(saved) as (keyof typeof saved)[]) {
    if (["shells", "resolution", "fps"].includes(key)) continue;
    assert.equal(agent[key], saved[key]);
    assert.equal(portrait[key], saved[key]);
    assert.equal(gallery[key], saved[key]);
  }
  assert.equal(agent.shells, 28);
  assert.equal(agent.resolution, 1.1);
  assert.equal(agent.fps, 60);
  assert.equal(portrait.shells, 40);
  assert.equal(portrait.resolution, 1.5);
  assert.equal(portrait.fps, 60);
  assert.equal(gallery.shells, 64);
  assert.equal(gallery.resolution, 1.2);
  assert.deepEqual(saved, original);
});

test("saved appearances are isolated per character and tolerate broken browser storage", () => {
  const serialized = JSON.stringify({ version: 2, personas: { silverash: { length: 1.8 }, exusiai: { length: 0.6 } } });
  assert.equal(savedFurSettings(serialized, "silverash").length, 1.8);
  assert.equal(savedFurSettings(serialized, "exusiai").length, 0.6);
  assert.deepEqual(savedFurSettings(serialized, "closure"), FUR_PRESETS.fine);
  for (const raw of ["broken", "null", '{"version":3,"personas":{}}', '{"version":2,"personas":[]}']) {
    assert.deepEqual(savedFurSettings(raw, "silverash"), FUR_PRESETS.fine);
  }
});
