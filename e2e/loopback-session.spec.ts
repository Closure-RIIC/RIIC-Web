import { createServer, type Server } from "node:http";
import { test, expect } from "@playwright/test";
import { attachLoopbackSession } from "./loopback-session";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback test server address.");
  return `http://127.0.0.1:${address.port}`;
}

test("signed loopback sessions use native requests without sending credentials to other origins", async ({ context, page, browserName }) => {
  const cookie = "__Secure-riic-test.session_token=loopback-test-only";
  let outsideRequests = 0;
  const outside = createServer((_request, response) => {
    outsideRequests++;
    response.end("outside");
  });
  const outsideURL = await listen(outside);
  const server = createServer((request, response) => {
    if (request.url === "/session") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ cookie: request.headers.cookie, method: request.method }));
    } else if (request.url === "/stream") {
      response.setHeader("Content-Type", "text/plain");
      response.write("first chunk");
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end("<html><body>Native session transport</body></html>");
    }
  });
  const baseURL = await listen(server);
  try {
    await context.addCookies([
      { name: "__Secure-riic-test.session_token", value: "loopback-test-only", domain: "127.0.0.1", path: "/", secure: true, httpOnly: true },
      { name: "riic-locale", value: "zh", domain: "127.0.0.1", path: "/" },
    ]);
    await attachLoopbackSession(context, baseURL, browserName, [cookie]);
    await page.goto(baseURL);
    const result = await page.evaluate(async () => (await fetch("/session", { method: "POST" })).json());
    expect(result.cookie).toContain(cookie);
    expect(result.cookie).toContain("riic-locale=zh");
    expect(result.method).toBe("POST");
    const firstChunk = await page.evaluate(async () => {
      const response = await fetch("/stream");
      const reader = response.body!.getReader();
      const first = await reader.read();
      await reader.cancel();
      return new TextDecoder().decode(first.value);
    });
    expect(firstChunk).toBe("first chunk");
    if (browserName === "webkit") {
      const reachedOutside = await page.evaluate(async url => {
        try { await fetch(url, { mode: "no-cors" }); return true; } catch { return false; }
      }, outsideURL);
      expect(reachedOutside).toBe(false);
      expect(outsideRequests).toBe(0);
    }
    await page.close();
  } finally {
    server.closeAllConnections();
    outside.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => outside.close(error => error ? reject(error) : resolve())),
    ]);
  }
});
