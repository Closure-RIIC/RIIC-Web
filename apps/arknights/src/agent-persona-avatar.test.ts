import assert from "node:assert/strict";
import test from "node:test";
import { detectPersonaAvatarImageType, parsePersonaAvatar } from "./agent-persona-avatar.ts";

test("persona avatar formats are detected from image bytes without browser MIME metadata", () => {
  assert.equal(detectPersonaAvatarImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectPersonaAvatarImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectPersonaAvatarImageType(Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary")), "image/webp");
});

test("persona avatar formats reject empty, truncated and unsupported image data", () => {
  for (const header of [
    new Uint8Array(),
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    Uint8Array.from([0xff, 0xd8]),
    Buffer.from("RIFF\x00\x00\x00\x00WEB", "binary"),
    Buffer.from("RIFF\x00\x00\x00\x00WAVE", "binary"),
    Buffer.from("GIF89a"),
    Buffer.from("<svg/>"),
  ]) assert.equal(detectPersonaAvatarImageType(header), undefined);
});

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
