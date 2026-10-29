import { fileURLToPath } from "node:url";
import helperScanner from "./x18n-scanner.mjs";
import { nextIntlWithRuntimeGrammar } from "./icu.mjs";
import { messageGitHistory } from "./git-history.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export function applicationProject(app) {
  return {
    root, name: app, sourceLocale: "zh-CN", locales: ["zh-CN", "zh-TW", "en"],
    presets: [nextIntlWithRuntimeGrammar()],
    plugins: [helperScanner(root)],
    history: { git: false, providers: [messageGitHistory] },
    resources: [
      { pattern: `apps/${app}/messages/{locale}/{namespace}.json` },
      { pattern: "packages/shell/messages/{locale}/{namespace}.json" },
      ...(app === "arknights" ? [{ pattern: "packages/arknights-domain/messages/{locale}/{namespace}.json" }] : []),
    ],
    namespace: { separator: "." },
    usage: {
      include: [`apps/${app}/src/**/*.{ts,tsx}`, `apps/${app}/i18n/usage-manifest.ts`, "packages/shell/**/*.{ts,tsx}", ...(app === "arknights" ? ["packages/arknights-domain/src/**/*.ts"] : [])],
      exclude: ["**/*.test.*", "**/generated/**", "**/routeTree.gen.ts", "**/message-types.ts", "**/messages.ts"],
      calls: [{ callee: "t", key: 0 }],
    },
    checks: {
      "missing-key": "error", "missing-translation": "error", "empty-translation": "error", "placeholder-mismatch": "error", "invalid-syntax": "error", "key-conflict": "error",
    },
  };
}
