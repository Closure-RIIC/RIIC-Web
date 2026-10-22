import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { canAccessEndfield, endfieldNotFound } from "./server/admin-access";

export default createServerEntry({
  async fetch(request, options) {
    if (!await canAccessEndfield(request)) return endfieldNotFound();
    const response = await handler.fetch(request, options);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
    return response;
  },
});
