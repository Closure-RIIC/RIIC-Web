import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { compressHtmlResponse } from "./html-compression.ts";

test("SSR compression preserves streaming text, status and private response headers", async () => {
  const text = "<html lang=\"zh-TW\">幹員資料與排班</html>".repeat(100);
  const chunks = [text.slice(0, 20), text.slice(20)];
  const response = new Response(new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
  }), { status: 203, statusText: "Non-Authoritative Information", headers: {
    "Content-Type": "text/html; charset=utf-8", "Content-Length": String(Buffer.byteLength(text)),
    "Cache-Control": "private, no-store", "Vary": "Cookie", "Set-Cookie": "ui-locale=zh-TW; Path=/",
  } });
  const compressed = compressHtmlResponse(new Request("https://example.test/", { headers: { "Accept-Encoding": "br, gzip;q=0.8" } }), response);
  assert.equal(compressed.status, 203);
  assert.equal(compressed.statusText, response.statusText);
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.equal(compressed.headers.get("content-length"), null);
  assert.equal(compressed.headers.get("cache-control"), "private, no-store");
  assert.equal(compressed.headers.get("vary"), "Cookie, Accept-Encoding");
  assert.equal(compressed.headers.get("set-cookie"), response.headers.get("set-cookie"));
  const bytes = Buffer.from(await compressed.arrayBuffer());
  assert.equal(gunzipSync(bytes).toString("utf8"), text);
  assert.ok(bytes.length < Buffer.byteLength(text) / 4);
});

test("unsupported encodings, precompressed bodies, API responses and empty responses pass through", async t => {
  for (const encoding of ["", "br", "gzip;q=0", "gzip;q=invalid"]) await t.test(encoding || "no encoding", () => {
    const response = new Response("document", { headers: { "Content-Type": "text/html" } });
    assert.equal(compressHtmlResponse(new Request("https://example.test/", { headers: { "Accept-Encoding": encoding } }), response), response);
  });
  const request = new Request("https://example.test/", { headers: { "Accept-Encoding": "gzip" } });
  for (const response of [new Response("{}", { headers: { "Content-Type": "application/json" } }),
    new Response("compressed", { headers: { "Content-Type": "text/html", "Content-Encoding": "br" } }),
    new Response(null, { status: 204 })]) assert.equal(compressHtmlResponse(request, response), response);
});
