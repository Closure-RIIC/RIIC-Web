import assert from "node:assert/strict";
import test from "node:test";

import { ApiClientError, computePlan, getHealth } from "./api.ts";
import { formatSolverDiagnostic, solverDiagnosticFor } from "./solver-diagnostic.ts";
import type { BaseBlueprint } from "./types.ts";

test("maps common solver failures to actionable guidance", () => {
  assert.match(solverDiagnosticFor({ code: "AIC-LAYOUT-1201", message: "布局无效", retryable: false }).suggestion, /设施等级/);
  assert.match(solverDiagnosticFor({ code: "AIC-PLAN-3002", message: "请求过于频繁", retryable: true }).title, /暂未获准/);
  assert.match(solverDiagnosticFor({ code: "AIC-PLAN-3006", message: "账号过于频繁", retryable: true }).title, /账号/);
  assert.match(solverDiagnosticFor({ code: "AIC-PLAN-3007", message: "网络过于频繁", retryable: true }).title, /网络/);
  assert.match(solverDiagnosticFor({ code: "AIC-PLAN-3008", message: "候选环已满", retryable: true }).title, /候选环/);
  assert.match(solverDiagnosticFor({ code: "AIC-PLAN-3003", message: "超时", retryable: true }).title, /超时/);
});

test("formats a complete copyable diagnostic with request id", () => {
  const text = formatSolverDiagnostic({ code: "AIC-PLAN-3003", message: "计算超时", retryable: true, requestId: "req-123", retryAfterSeconds: 45 });
  assert.match(text, /错误码：AIC-PLAN-3003/);
  assert.match(text, /请求编号：req-123/);
  assert.match(text, /建议等待：45 秒/);
  assert.match(text, /建议：/);
});

test("maps reverse-proxy responses without inventing request ids", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response("<h1>429 Too Many Requests</h1>", {
    status: 429,
    headers: {
      "Content-Type": "text/html",
      "Retry-After": "120",
    },
  });
  await assert.rejects(
    computePlan({
      layout: { template: "243", rooms: [] } as unknown as BaseBlueprint,
      operbox: [],
      sourceName: null,
      boxSource: "sample",
      rotation: "abc_12_6_6",
    }),
    (error: unknown) => {
      assert.equal(error instanceof ApiClientError, true);
      const apiError = error as ApiClientError;
      assert.equal(apiError.code, "AIC-PLAN-3002");
      assert.equal(apiError.message, "请求过于频繁，请等待 120 秒后重试。");
      assert.equal(apiError.requestId, undefined);
      return true;
    },
  );

  globalThis.fetch = async () => new Response("rate limited", {
    status: 429,
    headers: { "X-Request-Id": "proxy-request" },
  });
  await assert.rejects(getHealth(), (error: unknown) => {
    assert.equal(error instanceof ApiClientError, true);
    const apiError = error as ApiClientError;
    assert.equal(apiError.code, "AIC-RATE-6001");
    assert.equal(apiError.message, "请求过于频繁，请稍后重试。");
    assert.equal(apiError.requestId, "proxy-request");
    return true;
  });

  globalThis.fetch = async () => new Response("bad gateway", { status: 502 });
  await assert.rejects(getHealth(), (error: unknown) => {
    assert.equal(error instanceof ApiClientError, true);
    const apiError = error as ApiClientError;
    assert.equal(apiError.code, "AIC-SYS-5000");
    assert.equal(apiError.requestId, undefined);
    return true;
  });

  globalThis.fetch = async () => { throw new Error("offline"); };
  await assert.rejects(getHealth(), (error: unknown) => {
    assert.equal(error instanceof ApiClientError, true);
    const apiError = error as ApiClientError;
    assert.equal(apiError.message, "无法连接服务，请检查网络后重试。");
    assert.equal(apiError.requestId, undefined);
    return true;
  });
});
