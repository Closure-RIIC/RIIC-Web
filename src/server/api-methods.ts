/** Preserve Next route-handler method semantics instead of falling through to HTML. */
export function fallbackApiMethod(request: Request, methods: readonly string[]): Response {
  const allowed = new Set(methods);
  if (allowed.has("GET")) allowed.add("HEAD");
  allowed.add("OPTIONS");
  return new Response(null, {
    status: request.method === "OPTIONS" ? 204 : 405,
    headers: { Allow: [...allowed].sort().join(", "), "Cache-Control": "no-store" },
  });
}
