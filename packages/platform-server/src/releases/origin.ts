/** Endfield sends its browser origin through a trusted bridge to either host topology. */
export function endfieldWriteOriginAllowed(request: Request, trustProxy = process.env.BETA_TRUST_PROXY_HEADERS === "1"): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const actual = new URL(request.url);
  if (!trustProxy) return origin === actual.origin;
  const host = request.headers.get("x-forwarded-host");
  const protocol = request.headers.get("x-forwarded-proto");
  if (!host && !protocol) return origin === actual.origin;
  if (!host || !/^[a-zA-Z0-9.\-:[\]]+$/.test(host) || !["http", "https"].includes(protocol ?? "")) return false;
  try { return origin === new URL(`${protocol}://${host}`).origin; }
  catch { return false; }
}
