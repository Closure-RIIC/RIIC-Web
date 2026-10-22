/** Only persist bounded raster data or same-site images; never persist temporary blob URLs. */
export function parsePersonaAvatar(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 400_000) return undefined;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  if (/^\/images\/[A-Za-z0-9_./?=&%-]+$/.test(value) && !value.includes("..")) return value;
  return undefined;
}
