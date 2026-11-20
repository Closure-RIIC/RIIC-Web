import { createFileRoute } from "@tanstack/react-router";
import { trainingFarmingSnapshot } from "@/server/training-farming";

export const Route = createFileRoute("/api/training/farming")({
  server: { handlers: {
    GET: async () => {
      try {
        return Response.json(await trainingFarmingSnapshot(), {
          headers: { "Cache-Control": "public, max-age=900" },
        });
      } catch {
        return Response.json({ error: "drop_data_unavailable" }, { status: 503 });
      }
    },
  } },
});
