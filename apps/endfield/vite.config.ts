import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { tsconfigPaths: true },
  cacheDir: "node_modules/.vite",
  css: { postcss: { plugins: [] } },
  // Only upstream's documented diagnostic flags; never inject process.env wholesale.
  define: {
    "process.env.DSH_VARIANT_BUDGET": "undefined", "process.env.DSH_PRUNE_DEPTH": "undefined",
    "process.env.DSH_SIM_BURNIN": "undefined", "process.env.DEBUG_CAT": "undefined",
    "process.env.DEBUG_FILL": "undefined", "process.env.DEBUG_DFS": "undefined",
  },
  server: { host: "127.0.0.1", port: 5176, strictPort: true, fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  worker: { format: "es" },
  plugins: [{
    name: "endfield-development-dependency-cache",
    apply: "serve",
    config(config) { return { cacheDir: `node_modules/.vite/dev-${config.server?.port ?? 5176}` }; },
  }, tailwindcss(), tanstackStart(), nitro({ preset: "node-server" }), react()],
});
