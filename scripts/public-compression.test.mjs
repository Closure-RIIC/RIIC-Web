import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { ReadableStream } from "node:stream/web";
import test from "node:test";
import { URL } from "node:url";
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

function networkFailure(code) {
  return new TypeError("fetch failed: https://private.invalid/?token=do-not-log", {
    cause: Object.assign(new Error("private connection details"), { code }),
  });
}

function mockResponse(url) {
  if (new URL(url).pathname === "/") {
    return new globalThis.Response(documentBody(expectedBuildId), {
      headers: { "content-encoding": "gzip", "cache-control": "private, no-store" },
    });
  }
  return new globalThis.Response(scriptBody, { headers: { "content-encoding": "gzip" } });
}

test("temporary connection failures retry the failed GET and report safe diagnostics", async () => {
  const messages = [];
  let requests = 0;
  const result = await verifyPublicCompression("https://private.invalid/api/health?token=do-not-log", async (url) => {
    requests += 1;
    if (requests === 1) throw networkFailure("UND_ERR_CONNECT_TIMEOUT");
    return mockResponse(url);
  }, expectedBuildId, { retryDelayMs: 0, onRetry: message => messages.push(message) });
  assert.equal(result.buildId, expectedBuildId);
  assert.equal(requests, 3);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /public HTML response headers failed \(attempt 1\/3, \d+ms\): UND_ERR_CONNECT_TIMEOUT/);
  assert.doesNotMatch(messages[0], /private|token|do-not-log/);
});

test("a connection lost while reading JavaScript retries its entire response body", async () => {
  const messages = [];
  let scriptRequests = 0;
  await verifyPublicCompression("https://example.invalid/api/health", async (url) => {
    if (new URL(url).pathname !== "/" && ++scriptRequests === 1) {
      return new globalThis.Response(new ReadableStream({
        start(controller) { controller.error(networkFailure("UND_ERR_SOCKET")); },
      }), { headers: { "content-encoding": "gzip" } });
    }
    return mockResponse(url);
  }, expectedBuildId, { retryDelayMs: 0, onRetry: message => messages.push(message) });
  assert.equal(scriptRequests, 2);
  assert.match(messages[0], /public JavaScript #1 response body failed.*UND_ERR_SOCKET/);
});

test("persistent multi-address connection failures stop after three attempts", async () => {
  const messages = [];
  let requests = 0;
  await assert.rejects(verifyPublicCompression("https://example.invalid", async () => {
    requests += 1;
    throw new TypeError("private URL and addresses", {
      cause: new AggregateError([networkFailure("ETIMEDOUT"), networkFailure("ECONNRESET")]),
    });
  }, expectedBuildId, { retryDelayMs: 0, onRetry: message => messages.push(message) }), error => {
    assert.match(error.message, /attempt 3\/3.*ECONNRESET, ETIMEDOUT/);
    assert.doesNotMatch(error.message, /private|addresses/);
    return true;
  });
  assert.equal(requests, 3);
  assert.equal(messages.length, 2);
});

test("certificate failures and unclassified fetch errors fail without retries", async () => {
  for (const failure of [networkFailure("CERT_HAS_EXPIRED"), new TypeError("fetch failed: private endpoint")]) {
    let requests = 0;
    await assert.rejects(verifyPublicCompression("https://example.invalid", async () => {
      requests += 1;
      throw failure;
    }, expectedBuildId, { onRetry: () => assert.fail("Must not retry permanent failures") }), error => {
      assert.match(error.message, /CERT_HAS_EXPIRED|UNCLASSIFIED_NETWORK_ERROR/);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test("HTTP failures do not retry or become successful release checks", async () => {
  let requests = 0;
  await assert.rejects(verifyPublicCompression("https://example.invalid", async () => {
    requests += 1;
    return new globalThis.Response("unavailable", { status: 503 });
  }, expectedBuildId, { onRetry: () => assert.fail("Must not retry HTTP failures") }), /HTTP 503/);
  assert.equal(requests, 1);
});

for (const sendHeaders of [false, true]) {
  test(`request timeout cancels a stalled ${sendHeaders ? "body" : "connection"} and stops after three attempts`, async () => {
    const messages = [];
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      if (sendHeaders) {
        response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        response.flushHeaders();
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      await assert.rejects(verifyPublicCompression(`http://127.0.0.1:${server.address().port}`, globalThis.fetch,
        expectedBuildId, { requestTimeoutMs: 100, retryDelayMs: 0, onRetry: message => messages.push(message) }),
      new RegExp(`response ${sendHeaders ? "body" : "headers"} failed.*attempt 3/3.*REQUEST_TIMEOUT`));
      assert.equal(requests, 3);
      assert.equal(messages.length, 2);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}

test("the overall deadline also bounds time spent waiting to retry", async () => {
  let requests = 0;
  await assert.rejects(verifyPublicCompression("https://example.invalid", async () => {
    requests += 1;
    throw networkFailure("EAI_AGAIN");
  }, expectedBuildId, { totalTimeoutMs: 30, retryDelayMs: 100, onRetry: () => {} }), /CHECK_TIMEOUT/);
  assert.equal(requests, 1);
});

test("a deadline-limited retry wait cannot start another request if the wall clock trails the timer", async context => {
  let now = 0;
  let requests = 0;
  context.mock.method(Date, "now", () => now);
  await assert.rejects(verifyPublicCompression("https://example.invalid", async () => {
    requests += 1;
    throw networkFailure("EAI_AGAIN");
  }, expectedBuildId, { totalTimeoutMs: 30, retryDelayMs: 100, onRetry: () => { now = 29; } }), /CHECK_TIMEOUT/);
  assert.equal(requests, 1);
});

test("the overall deadline aborts an in-flight request before its individual timeout", async () => {
  let requests = 0;
  await assert.rejects(verifyPublicCompression("https://example.invalid", async (_url, { signal }) => {
    requests += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }, expectedBuildId, { totalTimeoutMs: 30, requestTimeoutMs: 100, onRetry: () => assert.fail("Total deadline must stop retries") }), /CHECK_TIMEOUT/);
  assert.equal(requests, 1);
});
