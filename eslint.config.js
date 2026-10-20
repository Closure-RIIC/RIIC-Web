import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".worktrees/**", ".alma-snapshots/**", ".gstack/**", "output/**"] },
  // Pinned, minified upstream code; lint its generator and typed integration.
  // Geometry and browser motion are checked by the dedicated Dijiang audits.
  { ignores: ["apps/endfield/src/components/dijiang-turn.mjs"] },
  { ignores: ["**/dist/**", "**/.output/**", "**/.tanstack/**", "**/routeTree.gen.ts", ".tmp", "server", "apps/arknights/src/lib/infra-eval/generated", "apps/arknights/src/lib/transitions/ui-generation.js", "apps/arknights/public/wasm", "packages/endfield-solver/upstream/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/build-infra-eval-wasm.mjs", "scripts/test-endfield*.mjs", "scripts/test-game-session-e2e.mjs", "apps/endfield/tests/*.mjs", "packages/endfield-solver/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-useless-assignment": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  }
);
