import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { DOCUMENT_CACHE_CONTROL } from "./server/http-cache-policy";

export default createServerEntry({
  async fetch(request, options) {
    const response = await handler.fetch(request, options);
    if (response.headers.get("content-type")?.includes("text/html")) {
      response.headers.set("Cache-Control", DOCUMENT_CACHE_CONTROL);
      const acceptsGzip = (request.headers.get("accept-encoding") ?? "").split(",").some((part) => {
        const [encoding, quality] = part.trim().split(";");
        return encoding === "gzip" && (!quality || Number(quality.trim().replace(/^q=/, "")) > 0);
      });
      if (acceptsGzip && response.body && !response.headers.has("content-encoding")) {
        const headers = new Headers(response.headers);
        headers.set("Content-Encoding", "gzip");
        headers.delete("Content-Length");
        headers.append("Vary", "Accept-Encoding");
        return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
          status: response.status, statusText: response.statusText, headers,
        });
      }
    }
    return response;
  },
});
