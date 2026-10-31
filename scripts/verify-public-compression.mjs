import assert from "node:assert/strict";
import path from "node:path";
import process, { stderr, stdout } from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

const ACCEPTED_ENCODINGS = new Set(["br", "gzip"]);
const MINIMUM_SCRIPT_BYTES = 1_024;
const RELEASE_ID_PATTERN = /^[0-9a-f]{40}$/;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRYABLE_NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
]);

function networkErrorCodes(error) {
  const codes = new Set();
  const seen = new Set();
  const pending = [error];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    // Error messages can contain the private health URL, query values or addresses.
    // Log only error codes, including nested fetch and multi-address failures.
    if (typeof current.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(current.code)) codes.add(current.code);
    if (current.cause) pending.push(current.cause);
    if (current instanceof AggregateError) pending.push(...current.errors);
  }
  return [...codes].sort();
}

function responseEncoding(response) {
  return response.headers.get("content-encoding")?.trim().toLowerCase() ?? "";
}

function assertCompressed(response, label) {
  const encoding = responseEncoding(response);
  assert.ok(
    ACCEPTED_ENCODINGS.has(encoding),
    `${label} must use gzip or Brotli for a real GET response; received ${encoding || "no Content-Encoding"}`,
  );
  return encoding;
}

function metaContent(document, name) {
  const metaTags = document.match(/<meta\b[^>]*>/giu) ?? [];
  const namedTag = metaTags.find((tag) => new RegExp(`\\bname=["']${name}["']`, "iu").test(tag));
  return namedTag?.match(/\bcontent=["']([^"']*)["']/iu)?.[1] ?? "";
}

export async function verifyPublicCompression(
  healthUrl,
  fetchImpl = globalThis.fetch,
  expectedBuildId = process.env.DEPLOY_SHA ?? "",
  {
    requestTimeoutMs = 60_000,
    totalTimeoutMs = 180_000,
    retryDelayMs = 1_000,
    onRetry = (message) => stderr.write(`${message}\n`),
  } = {},
) {
  const health = new URL(healthUrl);
  assert.ok(health.protocol === "https:" || health.protocol === "http:", "public health URL must use HTTP or HTTPS");

  const rootUrl = new URL("/", health);
  const requestOptions = {
    cache: "no-store",
    headers: { "accept-encoding": "br, gzip" },
    redirect: "follow",
  };
  const started = Date.now();
  const deadline = started + totalTimeoutMs;

  async function readResponse(url, label, bodyMethod) {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`${label}: total check deadline exceeded after ${Date.now() - started}ms (CHECK_TIMEOUT)`);
      }
      const controller = new globalThis.AbortController();
      const limitedByTotal = remainingMs <= requestTimeoutMs;
      const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remainingMs));
      const requestStarted = Date.now();
      let phase = "response headers";
      let failure;
      try {
        const response = await fetchImpl(url, { ...requestOptions, signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return { response };
        }
        phase = "response body";
        const body = await response[bodyMethod]();
        return { response, body };
      } catch (error) {
        failure = error;
      } finally {
        clearTimeout(timer);
      }

      const timedOut = controller.signal.aborted;
      const codes = timedOut
        ? [limitedByTotal ? "CHECK_TIMEOUT" : "REQUEST_TIMEOUT"]
        : networkErrorCodes(failure);
      const message = `${label} ${phase} failed (attempt ${attempt}/${MAX_REQUEST_ATTEMPTS}, ${Date.now() - requestStarted}ms): ${codes.join(", ") || "UNCLASSIFIED_NETWORK_ERROR"}`;
      const retryable = timedOut ? !limitedByTotal : codes.length > 0 && codes.every(code => RETRYABLE_NETWORK_CODES.has(code));
      if (!retryable || attempt === MAX_REQUEST_ATTEMPTS || Date.now() >= deadline) throw new Error(message);
      const waitMs = Math.min(retryDelayMs * attempt, Math.max(0, deadline - Date.now()));
      onRetry(`${message}; retrying in ${waitMs}ms`);
      await delay(waitMs);
    }
    throw new Error("Request attempts exhausted");
  }

  const { response: pageResponse, body: document } = await readResponse(rootUrl, "public HTML", "text");
  assert.ok(pageResponse.ok, `public page request failed with HTTP ${pageResponse.status}`);
  const pageEncoding = assertCompressed(pageResponse, "public HTML");
  const pageCacheControl = pageResponse.headers.get("cache-control")?.trim() ?? "";
  assert.match(
    pageCacheControl,
    /(?:^|,)\s*(?:private|no-store)(?:\s|,|$)/iu,
    `public HTML must not be stored by a shared cache; received ${pageCacheControl || "no Cache-Control"}`,
  );
  assert.doesNotMatch(
    pageCacheControl,
    /(?:^|,)\s*s-maxage\s*=/iu,
    `public HTML must not advertise shared-cache freshness; received ${pageCacheControl}`,
  );
  let buildId = "";
  if (expectedBuildId) {
    assert.match(expectedBuildId, RELEASE_ID_PATTERN, "expected public build ID must be a full lowercase commit SHA");
    buildId = metaContent(document, "riic-build-id");
    assert.equal(buildId, expectedBuildId, `public HTML build ID is ${buildId || "missing"}; expected ${expectedBuildId}`);
  }
  const scriptPaths = [...new Set([...document.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^"]*)?)"/g)].map((match) => match[1]))];
  assert.ok(scriptPaths.length > 0, "public HTML does not reference any JavaScript chunks");
  let verifiedScript;
  let scriptIndex = 0;
  for (const scriptPath of scriptPaths) {
    const scriptUrl = new URL(scriptPath, rootUrl);
    assert.equal(scriptUrl.origin, rootUrl.origin, "public HTML must load its initial JavaScript from the same origin");
    scriptIndex += 1;
    const { response: scriptResponse, body: scriptBody } = await readResponse(scriptUrl, `public JavaScript #${scriptIndex}`, "arrayBuffer");
    assert.ok(scriptResponse.ok, "public JavaScript request failed with HTTP " + scriptResponse.status);
    // Vite emits a tiny bootstrap; check every substantial script and modulepreload payload.
    if (scriptBody.byteLength < MINIMUM_SCRIPT_BYTES) continue;
    const scriptEncoding = assertCompressed(scriptResponse, "public JavaScript");
    verifiedScript ??= { scriptBytes: scriptBody.byteLength, scriptEncoding, scriptUrl: scriptResponse.url || scriptUrl.href };
  }
  assert.ok(verifiedScript, "public JavaScript verification chunks are unexpectedly small");

  return {
    buildId,
    pageEncoding,
    pageCacheControl,
    pageUrl: pageResponse.url || rootUrl.href,
    ...verifiedScript,
  };
}

const modulePath = path.normalize(fileURLToPath(import.meta.url)).toLowerCase();
const entryPath = process.argv[1] ? path.normalize(path.resolve(process.argv[1])).toLowerCase() : "";

if (entryPath === modulePath) {
  const healthUrl = process.argv[2] ?? process.env.DEPLOY_PUBLIC_HEALTH_URL;
  const expectedBuildId = process.env.DEPLOY_SHA ?? "";
  if (!healthUrl) {
    stderr.write("usage: node scripts/verify-public-compression.mjs <public-health-url>\n");
    process.exitCode = 1;
  } else {
    try {
      assert.match(expectedBuildId, RELEASE_ID_PATTERN, "DEPLOY_SHA must identify the public build being verified");
      const result = await verifyPublicCompression(healthUrl, globalThis.fetch, expectedBuildId);
      stdout.write(
        `public release ${result.buildId} passed: HTML ${result.pageEncoding} with non-shared caching; JavaScript ${result.scriptEncoding}, ${result.scriptBytes} decoded bytes\n`,
      );
    } catch (error) {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
