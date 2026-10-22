import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));

test("both apps own their source, routing, build config and assets", () => {
  for (const game of ["arknights", "endfield"]) {
    const app = `apps/${game}`;
    assert.equal(json(`${app}/package.json`).name, `@riic/${game}`);
    assert.equal(json(`${app}/tsconfig.json`).extends, "../../tsconfig.base.json");
    for (const entry of ["src/routes", "public", "vite.config.ts"]) {
      assert.ok(existsSync(path.join(root, app, entry)), `${app}/${entry}`);
    }
  }
  for (const obsolete of ["src", "public", "messages", "vite.config.ts"]) {
    assert.equal(existsSync(path.join(root, obsolete)), false, `${obsolete} must not mask an incomplete migration`);
  }
});

test("application imports never cross into the other app and shared packages never import apps", () => {
  const violations = [];
  function inspect(directory, owner) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".output", ".tanstack", "dist", "upstream"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file, owner); continue; }
      if (!/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from\s*|import\s*\(?|@import\s*|@source\s*|url\(\s*)["'](\.[^"']+)["']/g)) {
        const target = path.relative(root, path.resolve(path.dirname(file), match[1])).replaceAll("\\", "/");
        if (target.startsWith("apps/") && !target.startsWith(`apps/${owner}/`)) {
          violations.push(`${path.relative(root, file)} -> ${match[1]}`);
        }
      }
    }
  }
  for (const game of ["arknights", "endfield"]) inspect(path.join(root, "apps", game, "src"), game);
  inspect(path.join(root, "packages"), null);
  assert.deepEqual(violations, []);
});

test("the lockfile records both apps and every shared package as workspaces", () => {
  const lock = json("package-lock.json");
  for (const directory of ["apps", "packages", "services"]) {
    for (const name of readdirSync(path.join(root, directory))) {
      const file = `${directory}/${name}/package.json`;
      if (!existsSync(path.join(root, file))) continue;
      const manifest = json(file);
      assert.ok(lock.packages[`${directory}/${name}`], file);
      assert.equal(lock.packages[`node_modules/${manifest.name}`]?.link, true, manifest.name);
    }
  }
});

test("workspace imports use declared package entrypoints and never reach into apps", () => {
  const manifests = new Map();
  for (const group of ["apps", "packages", "services"]) for (const name of readdirSync(path.join(root, group))) {
    const directory = `${group}/${name}`;
    if (existsSync(path.join(root, directory, "package.json"))) manifests.set(directory, json(`${directory}/package.json`));
  }
  const byName = new Map([...manifests.values()].map(value => [value.name, value]));
  const violations = [];
  for (const [directory, manifest] of manifests) {
    if (directory.startsWith("packages/") && directory !== "packages/platform-server") {
      assert.equal(manifest.dependencies?.["@riic/platform-server"], undefined, `${manifest.name} must remain browser-safe`);
    }
    const inspect = current => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (["node_modules", ".output", "dist", ".tanstack", "upstream"].includes(entry.name)) continue;
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) { inspect(file); continue; }
        if (!/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        const check = specifier => {
          if (specifier.startsWith("@shared/")) violations.push(`${file}: legacy shared alias`);
          if (directory.startsWith("packages/") && specifier.startsWith("@/")) violations.push(`${file}: application alias in package`);
          if (!specifier.startsWith("@riic/")) return;
          const [scope, name, ...rest] = specifier.split("/");
          const packageName = `${scope}/${name}`, target = byName.get(packageName);
          if (packageName !== manifest.name && !manifest.dependencies?.[packageName] && !manifest.peerDependencies?.[packageName]) violations.push(`${file}: undeclared ${packageName}`);
          if (!target?.exports?.[rest.length ? `./${rest.join("/")}` : "."]) violations.push(`${file}: private or missing entry ${specifier}`);
        };
        const visit = node => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
          if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) check(node.argument.literal.text);
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text);
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    inspect(path.join(root, directory));
    if (directory.startsWith("packages/")) for (const target of Object.values(manifest.exports ?? {})) {
      assert.ok(existsSync(path.join(root, directory, target)), `${manifest.name}: missing exported file ${target}`);
    }
  }
  assert.deepEqual(violations, []);
});
