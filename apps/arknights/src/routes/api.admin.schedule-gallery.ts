import { createFileRoute } from "@tanstack/react-router";
import { fallbackApiMethod } from "@/server/api-methods";
import { handleGallery } from "@/server/gallery-api";
export const Route = createFileRoute("/api/admin/schedule-gallery")({ server: { handlers: {
  ANY: ({ request }) => fallbackApiMethod(request, ["GET", "POST"]),
  GET: ({ request }) => handleGallery(request, true), POST: ({ request }) => handleGallery(request, true),
} } });
