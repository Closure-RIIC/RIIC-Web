import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { isSklandFeatureEnabled } from "./src/deployment.ts";

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const sklandEnabled = isSklandFeatureEnabled(environment);
  const publicEnvironment = {
    APP_CLIENT_BUILD_ID: environment.APP_BUILD_ID ?? "local-development",
    APP_CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED: environment.ACCOUNT_CLOUD_SYNC_ENABLED === "1" ? "1" : "0",
    APP_CLIENT_SKLAND_ENABLED: sklandEnabled ? "1" : "0",
    APP_CLIENT_SKLAND_API_PREFIX: sklandEnabled ? "/api/skland" : "",
    PUBLIC_DEFAULT_LOCALE: environment.PUBLIC_DEFAULT_LOCALE ?? "zh",
  };
  return {
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
    environments: {
      client: { build: { rolldownOptions: { output: { strictExecutionOrder: true, codeSplitting: { groups: [
        { name: "core", tags: ["$initial"], priority: 30 },
        { name: "workbench", test: /src[\\/]routes[\\/]_workbench\.tsx\?tsr-split=component/, priority: 20 },
        { name: "calculator", test: /src[\\/]routes[\\/]_workbench\.index\.tsx\?tsr-split=component/, priority: 10 },
      ] } } } } },
    },
    server: { host: "0.0.0.0", port: 5174, proxy: { "/media/tutorials": { target: "http://127.0.0.1:18900", rewrite: (url) => url.replace(/^\/media\/tutorials/, "") } } },
    css: { postcss: { plugins: [] } },
    ssr: { noExternal: ["cookie-es"] },
    build: { manifest: true },
    plugins: [{ name: "riic-build-metadata", apply: "build", closeBundle() { mkdirSync("dist", { recursive: true }); writeFileSync("dist/riic-build.json", JSON.stringify({ sklandEnabled, buildId: publicEnvironment.APP_CLIENT_BUILD_ID })); } }, tailwindcss(), tanstackStart(), nitro({ preset: "node-server", compressPublicAssets: true,
      plugins: ["./src/server/nitro-http.ts"],
      routeRules: { "/assets/**": { headers: { "Cache-Control": "public, max-age=31536000, immutable" } } },
    }), react()],
  };
});
