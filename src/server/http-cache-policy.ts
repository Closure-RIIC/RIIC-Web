export const DOCUMENT_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function assetCacheControl(url: URL): string | undefined {
  if (url.pathname === "/wasm/infra-eval-manifest.json") return "public, max-age=0, must-revalidate";
  if (/^\/(assets|wasm)\//.test(url.pathname) || /^\/images\/(profession|building-room-emblems|ui|elite)\/[^/]+$/.test(url.pathname)) return IMMUTABLE_CACHE_CONTROL;
  if (/^\/images\/(operator-portraits|products|building-skills)\/[^/]+$/.test(url.pathname)
    && /^\d+-[0-9a-f]{12}$/.test(url.searchParams.get("v") ?? "")) return IMMUTABLE_CACHE_CONTROL;
  if (/^\/images\//.test(url.pathname)) return "public, max-age=0";
  return undefined;
}
