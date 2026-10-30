import { definePlugin } from "nitro";
import { canAccessEndfield, endfieldNotFound } from "./admin-access";
import { restoreHttpsProxyRequest } from "./proxy-request";
import { applyEndfieldCachePolicy } from "./cache-policy";

// Wrap the runtime before Nitro's static-file middleware can answer a request.
export default definePlugin(app => {
  const handle = app.fetch;
  app.fetch = async request => {
    request = restoreHttpsProxyRequest(request);
    if (!await canAccessEndfield(request)) return endfieldNotFound();
    const response = await handle(request);
    applyEndfieldCachePolicy(request, response);
    return response;
  };
});
