export function parseWishInput(value: unknown): { title: string; content: string; imageUrls: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 120
    || typeof body.content !== "string" || !body.content.trim() || body.content.length > 5000) return null;
  const images = body.imageUrls ?? [];
  if (!Array.isArray(images) || images.length > 4) return null;
  if (!images.every((image): image is string => typeof image === "string"
    && image.length <= 1_500_000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) return null;
  if (images.reduce((total, image) => total + image.length, 0) > 4_000_000) return null;
  return { title: body.title.trim(), content: body.content.trim(), imageUrls: images };
}
