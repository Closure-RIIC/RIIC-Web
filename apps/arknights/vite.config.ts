import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { isSklandFeatureEnabled } from "@riic/arknights-domain/deployment";
import { assetCacheControl } from "./src/server/http-cache-policy.ts";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const sklandEnabled = isSklandFeatureEnabled(environment);
  const publicEnvironment = {
    APP_CLIENT_BUILD_ID: environment.APP_BUILD_ID ?? "local-development",
    APP_CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED: environment.ACCOUNT_CLOUD_SYNC_ENABLED === "1" ? "1" : "0",
    APP_CLIENT_SKLAND_ENABLED: sklandEnabled ? "1" : "0",
    APP_CLIENT_SKLAND_API_PREFIX: sklandEnabled ? "/api/skland" : "",
    PUBLIC_DEFAULT_LOCALE: environment.PUBLIC_DEFAULT_LOCALE ?? "zh",
  };
  return {
    root: appRoot,
    envDir: repoRoot,
    resolve: {
      tsconfigPaths: true,
      alias: {
        "workbench-inventory-route": fileURLToPath(new URL(sklandEnabled ? "./src/components/pages/InventoryPage.tsx" : "./src/components/workbench/InventoryRoute.disabled.tsx", import.meta.url)),
        "account-cloud-workspace-bridge": fileURLToPath(new URL(environment.ACCOUNT_CLOUD_SYNC_ENABLED === "1"
          ? "./src/components/cloud/useAccountCloudWorkspace.tsx"
          : "./src/components/cloud/useAccountCloudWorkspace.disabled.ts", import.meta.url)),
        "workbench-skland-route": fileURLToPath(new URL(sklandEnabled
          ? "./src/components/workbench/SklandRoute.tsx"
          : "./src/components/workbench/SklandRoute.disabled.tsx", import.meta.url)),
      },
    },
    define: Object.fromEntries(Object.entries(publicEnvironment).map(([key, value]) => [
      `process.env.${key}`, JSON.stringify(value),
    ])),
    // The assistant is loaded on demand; optimize its SDKs before the first click.
    optimizeDeps: { include: ["ai", "@ai-sdk/react"] },
    environments: {
      client: { build: { rolldownOptions: { output: { strictExecutionOrder: true, codeSplitting: { groups: [
        { name: "core", tags: ["$initial"], priority: 30 },
        { name: "workbench", test: /src[\\/]routes[\\/]_workbench\.tsx\?tsr-split=component/, priority: 20 },
        { name: "calculator", test: /src[\\/]routes[\\/]_workbench\.index\.tsx\?tsr-split=component/, priority: 10 },
      ] } } } } },
    },
    server: {
      host: "0.0.0.0", port: 5174,
      fs: { allow: [repoRoot] },
      // Playwright trace HTML is not app source and must not reload preview tabs.
      watch: { ignored: ["**/.tmp/**", "**/test-results/**", "**/playwright-report/**"] },
      proxy: { "/media/tutorials": { target: "http://127.0.0.1:18900", rewrite: (url) => url.replace(/^\/media\/tutorials/, "") } },
    },
    css: { postcss: { plugins: [] } },
    ssr: { noExternal: ["cookie-es"] },
    build: { manifest: true },
    plugins: [{
      name: "riic-development-dependency-cache",
      apply: "serve",
      config(config) {
        // Concurrent dev/test servers must not replace each other's optimized deps.
        return { cacheDir: `node_modules/.vite/dev-${config.server?.port ?? 5174}` };
      },
    }, {
      name: "riic-development-asset-cache",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://localhost");
          // Nitro dev otherwise compresses this already-gzipped binary again.
          // Linux WebKit preserves application/gzip bodies during HTTP decoding,
          // leaving an extra gzip layer for the texture loader to misinterpret.
          if (/^\/textures\/[^/]+\.bin\.gz$/.test(url.pathname)) {
            req.headers["accept-encoding"] = "identity";
          }
          if (!/^\/images\//.test(url.pathname) && !/^\/wasm\//.test(url.pathname)) return next();
          const policy = assetCacheControl(url) ?? "public, max-age=0";
          const writeHead = res.writeHead;
          // Vite's static middleware otherwise replaces the production cache policy.
          res.writeHead = function (this: typeof res, ...args: Parameters<typeof writeHead>) {
            if (args[0] >= 200 && args[0] < 300) {
              const headers = args[1];
              if (headers && typeof headers === "object" && !Array.isArray(headers)) {
                for (const key of Object.keys(headers)) {
                  if (key.toLowerCase() === "cache-control") delete headers[key];
                }
              }
              this.setHeader("Cache-Control", policy);
            }
            return writeHead.apply(this, args);
          } as typeof writeHead;
          next();
        });
      },
    }, { name: "riic-build-metadata", apply: "build", closeBundle() { mkdirSync(new URL("./dist/", import.meta.url), { recursive: true }); writeFileSync(new URL("./dist/riic-build.json", import.meta.url), JSON.stringify({ sklandEnabled, buildId: publicEnvironment.APP_CLIENT_BUILD_ID })); } }, tailwindcss(), tanstackStart(), nitro({ preset: "node-server", compressPublicAssets: true,
      plugins: ["./src/server/nitro-http.ts"],
      routeRules: { "/assets/**": { headers: { "Cache-Control": "public, max-age=31536000, immutable" } } },
    }), react(), {
      name: "riic-development-request-cancellation",
      configureServer(server) {
        return () => {
          // Nitro forwards disconnected HTTP streams to Connect. A client leaving
          // a page must not broadcast Vite's error overlay to every open tab.
          server.middlewares.use((error: unknown, req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
            if ((req.aborted || res.destroyed) && error instanceof Error &&
              (("code" in error && error.code === "ECONNRESET") || error.name === "AbortError")) return;
            next(error);
          });
        };
      },
    }],
  };
});
