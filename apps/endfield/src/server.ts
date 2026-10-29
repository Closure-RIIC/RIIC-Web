import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { canAccessEndfield, endfieldNotFound } from "./server/admin-access";
import { compressHtmlResponse } from "@riic/platform-server/html-compression";
import { isEndfieldReleasePath } from "@riic/platform-server/proxy";
import { forwardEndfieldReleases } from "./server/release-proxy";

export default createServerEntry({
  async fetch(request, options) {
    if (!await canAccessEndfield(request)) return endfieldNotFound();
    if (isEndfieldReleasePath(new URL(request.url).pathname)) return forwardEndfieldReleases(request);
    const response = await handler.fetch(request, options);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
    return compressHtmlResponse(request, response);
  },
});
