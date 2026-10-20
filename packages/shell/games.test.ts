import assert from "node:assert/strict";
import test from "node:test";
import { gameHref } from "./games.ts";
test("game navigation preserves local host and uses isolated apps", () => {
  assert.equal(gameHref("endfield", "http://127.0.0.1:5175/settings?x=1"), "http://127.0.0.1:5176/");
  assert.equal(gameHref("arknights", "http://localhost:5176"), "http://localhost:5175/");
  assert.equal(gameHref("endfield", "https://riic.autos"), "https://endfield.riic.autos/");
  assert.equal(gameHref("arknights"), "https://riic.autos/");
});
test("configured origins cannot inject unsafe schemes, tokens or paths", () => {
  for (const origin of ["javascript:alert(1)", "https://user:PASSWORD@riic.autos", "https://riic.autos/?token=abc", "http://riic.autos", "https://riic.autos/agent"]) {
    assert.throws(() => gameHref("endfield", undefined, origin));
  }
  assert.equal(gameHref("endfield", undefined, "https://preview.example.com"), "https://preview.example.com/");
});
