import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".tanstack", "src/routeTree.gen.ts", ".tmp", "server", "src/lib/infra-eval/generated", "src/lib/transitions/ui-generation.js", "public/wasm"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/build-infra-eval-wasm.mjs"],
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
