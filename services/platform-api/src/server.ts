import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handlePlatformRequest } from "@riic/platform-server/http-api";
import { sharedSessionConfiguration } from "@riic/platform-server/auth/shared-session";

const hostname = process.env.PLATFORM_HOST ?? "127.0.0.1";
const port = Number(process.env.PLATFORM_PORT ?? 5177);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PLATFORM_PORT");
// Validate once at startup; malformed shared-cookie configuration must not serve traffic.
sharedSessionConfiguration();
const server = createServer({ maxHeaderSize: 32 * 1024 }, async (incoming, outgoing) => {
  const abort = new AbortController();
  incoming.on("aborted", () => abort.abort());
  outgoing.on("close", () => { if (!outgoing.writableEnded) abort.abort(); });
  try {
    const trustedProxy = process.env.BETA_TRUST_PROXY_HEADERS === "1";
    const host = trustedProxy ? incoming.headers["x-forwarded-host"] ?? incoming.headers.host : incoming.headers.host;
    const protocol = trustedProxy && incoming.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    if (typeof host !== "string" || !/^[a-zA-Z0-9.\-:[\]]+$/.test(host)) { outgoing.writeHead(400).end(); return; }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = incoming.method ?? "GET";
    const request = new Request(new URL(incoming.url ?? "/", `${protocol}://${host}`), {
      method, headers, signal: abort.signal,
      ...(!["GET", "HEAD"].includes(method) ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
    } as RequestInit);
    const response = await handlePlatformRequest(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => { if (name !== "set-cookie") outgoing.setHeader(name, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie", cookies);
    if (response.body && method !== "HEAD") await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Cache-Control": "private, no-store" });
    outgoing.end();
  }
});
server.requestTimeout = 70_000;
server.headersTimeout = 15_000;
server.listen(port, hostname, () => process.stdout.write(`RIIC platform listening on ${hostname}:${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
