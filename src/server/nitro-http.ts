import { definePlugin } from "nitro";
import { assetCacheControl } from "./http-cache-policy";

export default definePlugin((app) => {
  app.hooks.hook("response", (response, event) => {
    const policy = assetCacheControl(new URL(event.req.url));
    if (policy && response.ok) response.headers.set("Cache-Control", policy);
  });
});
