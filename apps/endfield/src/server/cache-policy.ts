/** Only public, successful static files may be reused across visitors. */
export function applyEndfieldCachePolicy(request: Request, response: Response, mode = process.env.ENDFIELD_ACCESS_MODE?.trim() || "public") {
  const path = new URL(request.url).pathname;
  const readable = mode === "public" && ["GET", "HEAD"].includes(request.method)
    && [200, 304].includes(response.status) && !response.headers.has("set-cookie");
  const immutable = readable && /^\/assets\/[\w.-]+-[\w-]{8,}\.(?:js|css|woff2?|ttf|svg|png|webp|ico)$/.test(path);
  const image = readable && /^\/images\/[\w/.-]+\.(?:png|webp|svg|jpe?g|ico)$/.test(path);
  response.headers.set("Cache-Control", immutable ? "public, max-age=31536000, immutable"
    : image ? "public, max-age=3600" : "private, no-store");
  const vary = (response.headers.get("Vary") ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!immutable && !image && !vary.some(value => value.toLowerCase() === "cookie")) vary.push("Cookie");
  // Preserve content negotiation (e.g. encoding); public assets do not vary by session.
  const selected = immutable || image ? vary.filter(value => value.toLowerCase() !== "cookie") : vary;
  if (selected.length) response.headers.set("Vary", selected.join(", "));
  else response.headers.delete("Vary");
}
