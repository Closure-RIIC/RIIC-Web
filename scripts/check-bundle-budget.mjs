import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { stdout } from "node:process";
import { URL } from "node:url";
import { gzipSync } from "node:zlib";
import { loadRouteBundleStats } from "./build-manifest.mjs";
import { renderBuildDocument } from "./render-build-document.mjs";

// The calculator keeps its always-visible board in the initial graph. Secondary workbench
// views have independent route chunks and may carry their own datasets without joining `/`.
// use-intl + ICU formatting adds ~78 KB raw / 22 KB gzip to the verified
// Skland-enabled build after namespace splitting. Allow 90 KB / 26 KB for this
// intentional shared runtime; keep route independence and lazy-chunk checks.
const MAX_SKLAND_DISABLED_ROUTE_INITIAL_JS_BYTES = 1_257_000;
// The language switch, protected manual-scheduling entry, and compact bilingual shell copy
// are part of the initial graph; the full editor and schedule conversion logic stay in
// on-demand chunks. Keep roughly 8 KB of raw headroom over the verified enabled build.
const MAX_SKLAND_ENABLED_ROUTE_INITIAL_JS_BYTES = 1_293_000;
// The changelog entry, use-intl runtime, task progress UI, and training tooltips add
// intentional code to workbench routes. Release content and the admin editor remain lazy.
// The manual editor owns a larger independent page chunk, so track it separately while
// keeping each ceiling narrow enough to flag unrelated bundle growth.
const MAX_SECONDARY_ROUTE_INITIAL_JS_BYTES = 1_672_000;
const MAX_MANUAL_ROUTE_INITIAL_JS_BYTES = 1_692_000;
const MAX_SKLAND_ROUTE_INITIAL_JS_BYTES = 1_732_000;
const MAX_SKLAND_DISABLED_DOCUMENT_INITIAL_JS_BYTES = 1_370_000;
const MAX_SKLAND_ENABLED_DOCUMENT_INITIAL_JS_BYTES = 1_406_000;
const MAX_SKLAND_DISABLED_DOCUMENT_INITIAL_GZIP_JS_BYTES = 442_000;
const MAX_SKLAND_ENABLED_DOCUMENT_INITIAL_GZIP_JS_BYTES = 448_000;
const MAX_DOCUMENT_INITIAL_JS_FILES = 18;
const WORKBENCH_ROUTES = ["/", "/manual", "/training", "/mastery", "/recruitment", "/skills", "/skland", "/settings"];
const buildRootUrl = new URL("../apps/arknights/.output/public/", import.meta.url);
const COMPACT_SCHEDULE_MARKER = "data-compact-schedule-view";
const staticChunksUrl = new URL("assets/", buildRootUrl);
const stats = await loadRouteBundleStats();
const buildMetadata = JSON.parse(await readFile(new URL("../apps/arknights/.output/riic-build.json", import.meta.url), "utf8"));

assert.ok(Array.isArray(stats), "route bundle stats must be an array; run npm run build first");
const rootRoute = stats.find((entry) => entry?.route === "/");
assert.ok(rootRoute, "route bundle stats do not contain the / route");
assert.ok(
  Number.isFinite(rootRoute.firstLoadUncompressedJsBytes),
  "/ firstLoadUncompressedJsBytes must be a finite number",
);

const rootChunks = new Set(rootRoute.firstLoadChunkPaths);
const sklandRoute = stats.find((entry) => entry?.route === "/skland");
assert.ok(sklandRoute, "route bundle stats do not contain the /skland route");
const sklandEnabled = buildMetadata.sklandEnabled;
const maxRootRouteInitialJsBytes = sklandEnabled
  ? MAX_SKLAND_ENABLED_ROUTE_INITIAL_JS_BYTES
  : MAX_SKLAND_DISABLED_ROUTE_INITIAL_JS_BYTES;
assert.ok(
  rootRoute.firstLoadUncompressedJsBytes <= maxRootRouteInitialJsBytes,
  `/ route initial uncompressed JavaScript is ${rootRoute.firstLoadUncompressedJsBytes} bytes, exceeding the ${maxRootRouteInitialJsBytes} byte ${sklandEnabled ? "Skland-enabled" : "Skland-disabled"} budget`,
);

for (const route of WORKBENCH_ROUTES.slice(1)) {
  const routeStats = stats.find((entry) => entry?.route === route);
  assert.ok(routeStats, `route bundle stats do not contain the ${route} route`);
  const maxSecondaryRouteInitialJsBytes = route === "/skland" && sklandEnabled
    ? MAX_SKLAND_ROUTE_INITIAL_JS_BYTES
    : route === "/manual"
      ? MAX_MANUAL_ROUTE_INITIAL_JS_BYTES
      : MAX_SECONDARY_ROUTE_INITIAL_JS_BYTES;
  assert.ok(
    routeStats.firstLoadUncompressedJsBytes <= maxSecondaryRouteInitialJsBytes,
    `${route} initial uncompressed JavaScript is ${routeStats.firstLoadUncompressedJsBytes} bytes, exceeding the ${maxSecondaryRouteInitialJsBytes} byte budget`,
  );
  const hasIndependentPageChunk = routeStats.firstLoadChunkPaths.some((chunkPath) => !rootChunks.has(chunkPath));
  if (route === "/skland" && !sklandEnabled) {
    assert.ok(
      routeStats.firstLoadUncompressedJsBytes <= rootRoute.firstLoadUncompressedJsBytes,
      "the feature-disabled /skland route must not add client JavaScript",
    );
  } else {
    assert.ok(hasIndependentPageChunk, `${route} must retain an independent page chunk outside the / initial graph`);
  }
}

const document = await renderBuildDocument();
const initialScriptPaths = [...document.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^"]*)?)"/g)]
  .map((match) => new URL(match[1], "https://bundle-budget.invalid").pathname)
  .filter((pathname) => pathname.startsWith("/assets/"));
const uniqueInitialScriptPaths = [...new Set(initialScriptPaths)];

assert.ok(uniqueInitialScriptPaths.length > 0, "/ document does not reference any initial JavaScript chunks");
assert.ok(
  uniqueInitialScriptPaths.length <= MAX_DOCUMENT_INITIAL_JS_FILES,
  `/ document references ${uniqueInitialScriptPaths.length} initial JavaScript files, exceeding the ${MAX_DOCUMENT_INITIAL_JS_FILES} file budget`,
);

const initialScriptBodies = await Promise.all(uniqueInitialScriptPaths.map(async (pathname) => {
  const relativePath = pathname.slice(1);
  return readFile(new URL(relativePath, buildRootUrl));
}));
for (const marker of ["data-release-dialog", "data-release-notes", "data-admin-changelog"]) {
  assert.ok(
    !initialScriptBodies.some((body) => body.includes(marker)),
    `release content or dialog leaked into the initial document graph: ${marker}`,
  );
}
const documentInitialJsBytes = initialScriptBodies.reduce((total, body) => total + body.byteLength, 0);
const documentInitialGzipJsBytes = initialScriptBodies.reduce(
  (total, body) => total + gzipSync(body, { level: 9 }).byteLength,
  0,
);
const maxDocumentInitialJsBytes = sklandEnabled
  ? MAX_SKLAND_ENABLED_DOCUMENT_INITIAL_JS_BYTES
  : MAX_SKLAND_DISABLED_DOCUMENT_INITIAL_JS_BYTES;
const maxDocumentInitialGzipJsBytes = sklandEnabled
  ? MAX_SKLAND_ENABLED_DOCUMENT_INITIAL_GZIP_JS_BYTES
  : MAX_SKLAND_DISABLED_DOCUMENT_INITIAL_GZIP_JS_BYTES;

assert.ok(
  documentInitialJsBytes <= maxDocumentInitialJsBytes,
  `/ document initial uncompressed JavaScript is ${documentInitialJsBytes} bytes, exceeding the ${maxDocumentInitialJsBytes} byte budget`,
);
assert.ok(
  documentInitialGzipJsBytes <= maxDocumentInitialGzipJsBytes,
  `/ document initial gzip JavaScript is ${documentInitialGzipJsBytes} bytes, exceeding the ${maxDocumentInitialGzipJsBytes} byte budget`,
);

const compactScheduleChunks = [];
for (const entry of await readdir(staticChunksUrl, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const contents = await readFile(new URL(entry.name, staticChunksUrl), "utf8");
  if (contents.includes(COMPACT_SCHEDULE_MARKER)) compactScheduleChunks.push(entry.name);
}
assert.ok(compactScheduleChunks.length > 0, "production build is missing the compact schedule chunk marker");

for (const [index, body] of initialScriptBodies.entries()) {
  assert.doesNotMatch(
    body.toString("utf8"),
    new RegExp(COMPACT_SCHEDULE_MARKER),
    `compact schedule code leaked into the initially loaded application chunk ${uniqueInitialScriptPaths[index]}`,
  );
}

stdout.write(
  [
    `/ route bundle budget passed (${sklandEnabled ? "Skland enabled" : "Skland disabled"}): ${rootRoute.firstLoadUncompressedJsBytes} / ${maxRootRouteInitialJsBytes} uncompressed JS bytes`,
    `secondary workbench route budget passed: enabled routes stay independent; ordinary routes stay below ${MAX_SECONDARY_ROUTE_INITIAL_JS_BYTES} and Skland stays below ${MAX_SKLAND_ROUTE_INITIAL_JS_BYTES} raw bytes`,
    `/ document preload budget passed: ${uniqueInitialScriptPaths.length} / ${MAX_DOCUMENT_INITIAL_JS_FILES} files, ${documentInitialJsBytes} / ${maxDocumentInitialJsBytes} raw bytes, ${documentInitialGzipJsBytes} / ${maxDocumentInitialGzipJsBytes} gzip bytes`,
    `compact schedule split passed: ${compactScheduleChunks.length} lazy chunk(s) stay outside the initially loaded application graph`,
    "",
  ].join("\n"),
);
