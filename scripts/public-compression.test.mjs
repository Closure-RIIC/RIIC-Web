import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { verifyPublicCompression } from "./verify-public-compression.mjs";

const scriptBody = "globalThis.__compressionCheck = true;\n".repeat(64);
const expectedBuildId = "b".repeat(40);

function documentBody(buildId) {
  return `<!doctype html><html><head><meta name="riic-build-id" content="${buildId}"></head><body><script src="/assets/app.js"></script></body></html>`;
}

async function withServer({
  buildId = expectedBuildId,
  compressScript,
  moduleBootstrap = false,
  pageCacheControl = "private, no-cache, no-store, max-age=0, must-revalidate",
}, run) {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {
        "cache-control": pageCacheControl,
        "content-encoding": "gzip",
        "content-type": "text/html; charset=utf-8",
      });
      const html = moduleBootstrap ? documentBody(buildId).replace('<script src="/assets/app.js"></script>', '<script type="module" src="/assets/bootstrap.js"></script><link rel="modulepreload" href="/assets/app.js">') : documentBody(buildId);
      response.end(gzipSync(html));
      return;
    }
    if (request.url === "/assets/bootstrap.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end('import "./app.js";');
      return;
    }
    if (request.url === "/assets/app.js") {
      response.writeHead(200, {
        ...(compressScript ? { "content-encoding": "gzip" } : {}),
        "content-type": "application/javascript; charset=utf-8",
      });
      response.end(compressScript ? gzipSync(scriptBody) : scriptBody);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}/api/health`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("public compression verification accepts compressed HTML and JavaScript GET responses", async () => {
  await withServer({ compressScript: true }, async (healthUrl) => {
    const result = await verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId);
    assert.equal(result.pageEncoding, "gzip");
    assert.equal(result.buildId, expectedBuildId);
    assert.match(result.pageCacheControl, /no-store/);
    assert.equal(result.scriptEncoding, "gzip");
    assert.equal(result.scriptBytes, Buffer.byteLength(scriptBody));
  });
});

test("public compression verification rejects an uncompressed JavaScript GET response", async () => {
  await withServer({ compressScript: false }, async (healthUrl) => {
    await assert.rejects(
      verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId),
      /public JavaScript must use gzip or Brotli for a real GET response/,
    );
  });
});

test("module bootstrap verification checks the substantial preloaded payload", async () => {
  await withServer({ compressScript: true, moduleBootstrap: true }, async (healthUrl) => {
    const result = await verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId);
    assert.equal(result.scriptBytes, Buffer.byteLength(scriptBody));
    assert.equal(result.scriptEncoding, "gzip");
  });
});
test("a tiny bootstrap cannot hide an uncompressed preloaded payload", async () => {
  await withServer({ compressScript: false, moduleBootstrap: true }, async (healthUrl) => {
    await assert.rejects(verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId), /public JavaScript must use gzip or Brotli/);
  });
});

test("public release verification rejects HTML cached from a previous build", async () => {
  await withServer({ buildId: "a".repeat(40), compressScript: true }, async (healthUrl) => {
    await assert.rejects(
      verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId),
      /public HTML build ID is a{40}; expected b{40}/,
    );
  });
});

test("public release verification rejects HTML that shared caches may retain", async () => {
  await withServer({ compressScript: true, pageCacheControl: "s-maxage=31536000" }, async (healthUrl) => {
    await assert.rejects(
      verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId),
      /public HTML must not be stored by a shared cache/,
    );
  });
});
