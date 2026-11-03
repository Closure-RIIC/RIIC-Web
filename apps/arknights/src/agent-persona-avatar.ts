export function detectPersonaAvatarImageType(header: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => header[index] === byte)) return "image/png";
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if ([0x52, 0x49, 0x46, 0x46].every((byte, index) => header[index] === byte)
    && [0x57, 0x45, 0x42, 0x50].every((byte, index) => header[index + 8] === byte)) return "image/webp";
  return undefined;
}

/** Only persist bounded raster data or same-site images; never persist temporary blob URLs. */
export function parsePersonaAvatar(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 400_000) return undefined;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  if (/^\/images\/[A-Za-z0-9_./?=&%-]+$/.test(value) && !value.includes("..")) return value;
  return undefined;
}
