import assert from "node:assert/strict";
import path from "node:path";
import process, { stderr, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";

const ACCEPTED_ENCODINGS = new Set(["br", "gzip"]);
const MINIMUM_SCRIPT_BYTES = 1_024;
const RELEASE_ID_PATTERN = /^[0-9a-f]{40}$/;

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
) {
  const health = new URL(healthUrl);
  assert.ok(health.protocol === "https:" || health.protocol === "http:", "public health URL must use HTTP or HTTPS");

  const rootUrl = new URL("/", health);
  const requestOptions = {
    cache: "no-store",
    headers: { "accept-encoding": "br, gzip" },
    redirect: "follow",
  };
  const pageResponse = await fetchImpl(rootUrl, requestOptions);
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
  const document = await pageResponse.text();
  let buildId = "";
  if (expectedBuildId) {
    assert.match(expectedBuildId, RELEASE_ID_PATTERN, "expected public build ID must be a full lowercase commit SHA");
    buildId = metaContent(document, "riic-build-id");
    assert.equal(buildId, expectedBuildId, `public HTML build ID is ${buildId || "missing"}; expected ${expectedBuildId}`);
  }
  const scriptPaths = [...new Set([...document.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^"]*)?)"/g)].map((match) => match[1]))];
  assert.ok(scriptPaths.length > 0, "public HTML does not reference any JavaScript chunks");
  let verifiedScript;
  for (const scriptPath of scriptPaths) {
    const scriptUrl = new URL(scriptPath, rootUrl);
    assert.equal(scriptUrl.origin, rootUrl.origin, "public HTML must load its initial JavaScript from the same origin");
    const scriptResponse = await fetchImpl(scriptUrl, requestOptions);
    assert.ok(scriptResponse.ok, "public JavaScript request failed with HTTP " + scriptResponse.status);
    const scriptBody = await scriptResponse.arrayBuffer();
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
