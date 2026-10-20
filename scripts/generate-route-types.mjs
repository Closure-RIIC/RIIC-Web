import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { Generator, getConfig } from "@tanstack/router-generator";

const app = process.argv[2];
if (!["arknights", "endfield"].includes(app)) throw new Error("Expected arknights or endfield");
const root = fileURLToPath(new URL(`../apps/${app}/`, import.meta.url));
const config = getConfig({
  // Match TanStack Start's generated registration without starting a server or
  // relying on ignored route trees left behind by a previous development build.
  routeTreeFileFooter: [
    "import type { getRouter } from './router.tsx'",
    "import type { createStart } from '@tanstack/react-start'",
    "declare module '@tanstack/react-start' {",
    "  interface Register {",
    "    ssr: true",
    "    router: Awaited<ReturnType<typeof getRouter>>",
    "  }",
    "}",
  ],
}, root);
await new Generator({ config, root }).run();
