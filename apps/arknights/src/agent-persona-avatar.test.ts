import assert from "node:assert/strict";
import test from "node:test";
import { parsePersonaAvatar } from "./agent-persona-avatar.ts";

test("persona avatars restore raster uploads and existing site portraits", () => {
  for (const value of ["data:image/webp;base64,UklGRg==", "/images/operator-portraits/4228_closur.webp?v=2-bb48105cf738"]) {
    assert.equal(parsePersonaAvatar(value), value);
  }
});

test("persona avatars reject temporary, executable, external and oversized sources", () => {
  for (const value of [undefined, null, {}, "blob:https://example.test/id", "javascript:alert(1)", "https://example.test/a.png", "//example.test/a.png", "/images/../api/auth", "data:image/svg+xml;base64,PHN2Zz4=", `data:image/png;base64,${"a".repeat(400_000)}`]) {
    assert.equal(parsePersonaAvatar(value), undefined);
  }
});
