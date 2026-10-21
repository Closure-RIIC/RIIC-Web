import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  findOwnedScan,
  findReusableScan,
  hasScanStartCapacity,
  MAX_CONCURRENT_SCAN_STARTS,
  scanActorKey,
  type ReusableScanRecord,
} from "./scan-admission.ts";
import {
  classifySklandUpstreamError,
  SKLAND_UPSTREAM_COOLDOWN_MS,
} from "./upstream-error.ts";
import { publicCodeForSklandServiceError } from "./http-error.ts";
import { inventoryItemsFromResponse } from "./inventory-parser.ts";

const consent = {
  termsVersion: "terms-v1",
  privacyVersion: "privacy-v1",
};

test("scan actor keys isolate website accounts without retaining raw user ids", () => {
  const first = scanActorKey("website-user-one");
  assert.equal(first, scanActorKey("website-user-one"));
  assert.notEqual(first, scanActorKey("website-user-two"));
  assert.equal(first.includes("website-user-one"), false);
});

test("an active QR code is reused only for the same website account and policy", () => {
  const now = 10 * 60 * 1000;
  const actorKey = scanActorKey("website-user");
  const record: ReusableScanRecord = {
    actorKey,
    scanUrl: "https://example.com/scan",
    createdAt: now - 30_000,
    policyConsent: consent,
  };
  const scans = [["scan-one", record]] as const;

  assert.deepEqual(findReusableScan(scans, actorKey, consent, now), {
    scanId: "scan-one",
    scanUrl: record.scanUrl,
    expiresInSeconds: 570,
  });
  assert.equal(findReusableScan(scans, scanActorKey("another-user"), consent, now), null);
  assert.equal(findReusableScan(scans, actorKey, { ...consent, privacyVersion: "privacy-v2" }, now), null);
  assert.equal(findReusableScan(scans, actorKey, consent, now + 10 * 60 * 1000), null);
});

test("QR polling cannot read or consume another website account's scan", () => {
  const record: ReusableScanRecord = {
    actorKey: scanActorKey("website-user-a"),
    scanUrl: "https://example.com/scan",
    createdAt: Date.now(),
    policyConsent: consent,
  };
  const scans = new Map([["scan-a", record]]);

  assert.equal(findOwnedScan(scans, "scan-a", "website-user-b"), null);
  assert.equal(scans.get("scan-a"), record);
  assert.equal(findOwnedScan(scans, "scan-a", "website-user-a"), record);
});

test("the QR status route scopes polling and consumption to the authenticated website account", async () => {
  const route = await readFile(
    new URL("../../app/api/skland/auth/qr/status/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /pollScan\(scanId, website\.user\.id, request\.signal\)/);
  assert.match(route, /finalizeSklandAuthentication\([\s\S]+request\.signal\)/);
  assert.match(route, /setSklandAccountStoreCookies[\s\S]+request\.signal\.throwIfAborted\(\)[\s\S]+consumeScan\(scanId, website\.user\.id\)/);
});

test("global QR protection limits only concurrent upstream starts", () => {
  assert.equal(hasScanStartCapacity(MAX_CONCURRENT_SCAN_STARTS - 1), true);
  assert.equal(hasScanStartCapacity(MAX_CONCURRENT_SCAN_STARTS), false);
});

test("the ten-minute global quota that caused cross-account lockouts cannot return", async () => {
  const source = await readFile(new URL("./adapter.ts", import.meta.url), "utf8");
  const route = await readFile(
    new URL("../../app/api/skland/auth/qr/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /assertRate\(["']scan:global/);
  assert.match(source, /scan:actor:/);
  assert.match(source, /scan:ip:/);
  assert.match(source, /scanStartTasks/);
  assert.match(route, /enforceRateLimit\("skland-qr-account", website\.user\.id/);
});

test("skland-kit response messages identify expired stored credentials", () => {
  const error = new Error("【skland-kit】获取游戏绑定信息错误", {
    cause: { code: 10001, message: "用户未登录" },
  });
  assert.equal(classifySklandUpstreamError(error), "AUTH_EXPIRED");
  assert.equal(classifySklandUpstreamError(new Error("request failed", {
    cause: { status: 401, message: "authorization failed" },
  })), "AUTH_EXPIRED");
});

test("skland-kit response messages preserve upstream rate-limit and availability failures", () => {
  assert.equal(classifySklandUpstreamError(new Error("request failed", {
    cause: { code: 10002, message: "请求过于频繁" },
  })), "RATE_LIMITED");
  assert.equal(classifySklandUpstreamError(new Error("network unavailable")), "UNAVAILABLE");
});

test("Aliyun WAF burst responses enter the shared upstream cooldown", async () => {
  const wafResponse = new Error("【skland-kit】获取游戏绑定信息错误", {
    cause: '<!doctypehtml><html><title>405</title><img src="https://errors.aliyun.com/blocked.png">',
  });
  assert.equal(classifySklandUpstreamError(wafResponse), "RATE_LIMITED");
  assert.equal(SKLAND_UPSTREAM_COOLDOWN_MS, 60_000);

  const source = await readFile(new URL("./adapter.ts", import.meta.url), "utf8");
  assert.match(source, /__infraCalcSklandUpstreamCooldownUntil/);
  assert.match(source, /function assertUpstreamCapacity/);
  assert.match(source, /classification === "RATE_LIMITED"[\s\S]*beginUpstreamCooldown\(\)/);
  assert.ok((source.match(/assertUpstreamCapacity\(\)/g)?.length ?? 0) >= 3);
});

test("only missing configuration is reported as skland login being closed", () => {
  assert.equal(publicCodeForSklandServiceError("NOT_CONFIGURED"), "AIC-AUTH-2003");
  assert.equal(publicCodeForSklandServiceError("UNAVAILABLE"), "AIC-SYS-5000");
  assert.equal(publicCodeForSklandServiceError("AUTH_EXPIRED"), "AIC-AUTH-2001");
});

test("inventory parser keeps synthetic orundum across Skland response shapes", () => {
  assert.deepEqual(
    inventoryItemsFromResponse({
      items: [
        { itemId: "4003", amount: "1200" },
        { resource: { id: "4002" }, quantity: 3 },
      ],
      inventory: { "4003": 1200, "4002": 3 },
    }),
    [
      { id: "4003", count: 1200 },
      { id: "4002", count: 3 },
    ],
  );
  assert.deepEqual(
    inventoryItemsFromResponse({
      resources: [
        { type: "DIAMOND_SHD", value: 600 },
        { type: "GOLD", total: 10000 },
      ],
    }),
    [
      { id: "4003", count: 600 },
      { id: "4001", count: 10000 },
    ],
  );
});

test("inventory parser keeps zero-valued common resources for fixed inventory cards", () => {
  assert.deepEqual(
    inventoryItemsFromResponse({ items: [{ id: "4003", count: "0" }] }),
    [{ id: "4003", count: 0 }],
  );
});
