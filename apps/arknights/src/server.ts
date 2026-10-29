import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { DOCUMENT_CACHE_CONTROL } from "./server/http-cache-policy";
import { withPlatformRequest } from "@riic/platform-server/request-context";
import { forwardPlatformRequest, isPlatformPath, isEndfieldReleasePath } from "@riic/platform-server/proxy";
import { compressHtmlResponse } from "@riic/platform-server/html-compression";

export default createServerEntry({
  async fetch(request, options) {
    if (process.env.PLATFORM_API_ORIGIN && isPlatformPath(new URL(request.url).pathname)) {
      return forwardPlatformRequest(request);
    }
    const response = await withPlatformRequest(request, async () => {
      if (isEndfieldReleasePath(new URL(request.url).pathname)) {
        return (await import("@riic/platform-server/releases/api")).handleEndfieldReleases(request);
      }
      return handler.fetch(request, options);
    });
    if (response.headers.get("content-type")?.includes("text/html")) {
      response.headers.set("Cache-Control", DOCUMENT_CACHE_CONTROL);
    }
    return compressHtmlResponse(request, response);
  },
});
