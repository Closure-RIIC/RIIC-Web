import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const normalize = file => file.replaceAll("\\", "/");
export function resolveModule(specifier, file, root = process.cwd()) {
  let target;
  // Vite selects these implementations by deployment flags. The resource manifest
  // must cover the enabled implementation, including hooks behind an alias.
  const applicationAliases = {
    "account-cloud-workspace-bridge": "apps/arknights/src/components/cloud/useAccountCloudWorkspace.tsx",
    "workbench-inventory-route": "apps/arknights/src/components/pages/InventoryPage.tsx",
    "workbench-skland-route": "apps/arknights/src/components/workbench/SklandRoute.tsx",
  };
  if (applicationAliases[specifier]) target = path.resolve(root, applicationAliases[specifier]);
  else if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
  else if (specifier.startsWith("@/")) {
    const app = normalize(file).match(/apps\/(arknights|endfield)\//)?.[1];
    if (app) target = path.resolve(root, "apps", app, "src", specifier.slice(2));
  } else if (specifier.startsWith("@riic/")) {
    const [name, ...parts] = specifier.slice(6).split("/");
    const directory = path.resolve(root, "packages", name);
    if (!fs.existsSync(`${directory}/package.json`)) return;
    const pkg = JSON.parse(fs.readFileSync(`${directory}/package.json`, "utf8"));
    const key = parts.length ? `./${parts.join("/")}` : ".";
    let entry = pkg.exports?.[key];
    if (!entry) for (const [pattern, value] of Object.entries(pkg.exports ?? {})) {
      if (typeof value === "string" && pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1))) entry = value.replace("*", key.slice(pattern.length - 1));
    }
    if (typeof entry === "string") target = path.resolve(directory, entry);
  }
  if (!target) return;
  return [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

export function createModuleGraph(namespaces, root = process.cwd()) {
  const cache = new Map();
  function inspect(file) {
    if (cache.has(file)) return cache.get(file);
    const result = { namespaces: new Set(), imports: [], dynamic: [] };
    cache.set(file, result);
    const normalized = normalize(file);
    if (!/\.[cm]?tsx?$/.test(file) || /\/server\/|\/platform-server\/|routeTree\.gen|\/i18n\/(messages|message-types|feature-manifest|features-client|locale|server)\./.test(normalized)) return result;
    const source = fs.readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const add = value => { const name = value.split(".")[0]; if (namespaces.has(name)) result.namespaces.add(name); };
    const visit = node => {
      if (ts.isStringLiteral(node) && node.text.includes(".")) add(node.text);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (spec.includes("/messages/zh-CN/")) add(path.basename(spec, ".json"));
        if (!node.importClause?.isTypeOnly && !(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every(e => e.isTypeOnly))) {
          const target = resolveModule(spec, file, root); if (target) result.imports.push(target);
        }
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveModule(node.moduleSpecifier.text, file, root); if (target) result.imports.push(target);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(ast);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
          const target = resolveModule(node.arguments[0].text, file, root);
          if (target) { result.dynamic.push(target); if (!target.endsWith(".tsx")) result.imports.push(target); }
        } else if (callee === "useGameCatalog") add("ArknightsGameData");
        else if (callee === "messageRecord") add(normalized.includes("/packages/shell/") ? "AccountRecords" : "records");
        else if (/useTranslations|create.*Localizer|\.text$|\.rich$|getCatalog|^t$|^intl$/.test(callee)) {
          for (const arg of node.arguments) if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) add(arg.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return result;
  }
  function resources(entry, seen = new Set()) {
    if (seen.has(entry)) return new Set();
    seen.add(entry);
    const module = inspect(entry), result = new Set(module.namespaces);
    for (const imported of module.imports) for (const namespace of resources(imported, seen)) result.add(namespace);
    return result;
  }
  return { inspect, resources };
}
