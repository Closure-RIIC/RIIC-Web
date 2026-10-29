import type { Plugin } from "vite";

/** Node's source tests need JSON attributes; Vite's dev client serves JSON as JS. */
export function i18nDevJsonModules(): Plugin {
  return {
    name: "riic-i18n-dev-json",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (this.environment.name !== "client" || !/\/src\/i18n\/loaders\/[^/]+\.ts(?:\?|$)/.test(id.replaceAll("\\", "/"))) return;
      return { code: code.replaceAll(', { with: { type: "json" } }', ""), map: null };
    },
  };
}
