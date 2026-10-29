import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const modules = new Map();
const typeContracts = new WeakMap();
const scopeDeclarations = new WeakMap();
function lexicalDeclaration(identifier) {
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isFunctionLike(scope)) continue;
    let declarations = scopeDeclarations.get(scope);
    if (!declarations) {
      declarations = new Map();
      const record = node => {
        if (ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
        else if (ts.isArrayBindingPattern(node.name)) for (const element of node.name.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) declarations.set(element.name.text, node);
        }
      };
      const visit = node => {
        if (node !== scope && (ts.isBlock(node) || ts.isFunctionLike(node))) return;
        if (ts.isVariableDeclaration(node)) record(node);
        ts.forEachChild(node, visit);
      };
      if (ts.isFunctionLike(scope)) for (const parameter of scope.parameters) record(parameter);
      else visit(scope);
      scopeDeclarations.set(scope, declarations);
    }
    if (declarations.has(identifier.text)) return declarations.get(identifier.text);
  }
}
function moduleInfo(file) {
  const version = fs.statSync(file).mtimeMs;
  let cached = modules.get(file);
  if (cached?.version !== version) {
    const text = fs.readFileSync(file, "utf8");
    cached = { version, ast: parse(file, text), definitions: definitions(file, text) };
    modules.set(file, cached);
  }
  return cached;
}
const sourceNamespaces = new Map();
function namespacesFor(root, file) {
  const app = file.replaceAll("\\", "/").match(/apps\/(arknights|endfield)\//)?.[1];
  const key = `${root}:${app ?? "shared"}`;
  if (!sourceNamespaces.has(key)) {
    const dirs = ["packages/shell/messages/zh-CN", "packages/arknights-domain/messages/zh-CN", ...(app ? [`apps/${app}/messages/zh-CN`] : [])];
    sourceNamespaces.set(key, new Set(dirs.flatMap(dir => fs.existsSync(path.resolve(root, dir)) ? fs.readdirSync(path.resolve(root, dir)).filter(file => file.endsWith(".json")).map(file => file.slice(0, -5)) : [])));
  }
  return sourceNamespaces.get(key);
}
function definitions(file, text) {
  const ast = parse(file, text);
  const result = new Map();
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      if (/create.*Localizer/i.test(call.expression.getText(ast)) && ts.isStringLiteral(call.arguments[0])) result.set(node.name.text, call.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

function importFile(specifier, file, root) {
  let target;
  if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
  else if (specifier.startsWith("@/")) {
    const app = file.replaceAll("\\", "/").match(/apps\/(arknights|endfield)\//)?.[1];
    if (app) target = path.join(root, "apps", app, "src", specifier.slice(2));
  } else if (specifier.startsWith("@riic/arknights-domain/")) target = path.join(root, "packages/arknights-domain/src", specifier.slice("@riic/arknights-domain/".length));
  else if (specifier.startsWith("@riic/shell/")) target = path.join(root, "packages/shell", specifier.slice("@riic/shell/".length));
  if (!target) return;
  return [target, `${target}.ts`, `${target}.tsx`].find(candidate => /\.[cm]?tsx?$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/** Adds explicit-locale helpers and structured records to the standard next-intl scanner. */
export function scanHelpers(file, root) {
  const absolute = path.resolve(root, file.path);
  const ast = parse(file.path, file.text);
  if (file.path.replaceAll("\\", "/").endsWith("/i18n/usage-manifest.ts")) {
    const usages = [];
    const visit = node => {
      if (ts.isObjectLiteralExpression(node)) {
        const key = node.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText().replaceAll('"', '') === "key")?.initializer;
        const prefix = node.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText().replaceAll('"', '') === "prefix")?.initializer;
        if (key && ts.isStringLiteral(key)) usages.push({ raw: key.text, range: { start: key.getStart(), end: key.end }, kind: "constant", dynamic: prefix?.kind === ts.SyntaxKind.TrueKeyword ? "prefix" : false });
      }
      ts.forEachChild(node, visit);
    }; visit(ast); return { usages };
  }
  const bindings = definitions(file.path, file.text);
  const translators = new Map();
  const initializers = new Map();
  const annotations = new Map(), types = new Map(), returns = new Map();
  function collectTypes(tree) {
    const cached = typeContracts.get(tree);
    if (cached) {
      for (const [key, value] of cached.annotations) annotations.set(key, value);
      for (const [key, value] of cached.types) types.set(key, value);
      for (const [key, value] of cached.returns) returns.set(key, value);
      return;
    }
    const captured = { annotations: new Map(), types: new Map(), returns: new Map() };
    const record = (kind, key, value) => { captured[kind].set(key, value); ({ annotations, types, returns })[kind].set(key, value); };
    const visit = node => {
      if (ts.isTypeAliasDeclaration(node)) record("types", node.name.text, node.type);
      if (ts.isInterfaceDeclaration(node)) record("types", node.name.text, node);
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.type) {
        if (ts.isIdentifier(node.name)) record("annotations", node.name.text, node.type);
        else if (ts.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) record("annotations", element.name.text, { owner: node.type, property: element.propertyName?.getText() ?? element.name.text });
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === "useState" && node.initializer.typeArguments?.[0]) {
        const first = node.name.elements[0];
        if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) record("annotations", first.name.text, node.initializer.typeArguments[0]);
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const expressions = [];
        const visitReturn = child => {
          if (ts.isReturnStatement(child) && child.expression) expressions.push(child.expression);
          // Nested functions have their own contract.
          if (child !== node.body && ts.isFunctionLike(child)) return;
          ts.forEachChild(child, visitReturn);
        };
        visitReturn(node.body); record("returns", node.name.text, expressions);
      }
      ts.forEachChild(node, visit);
    }; visit(tree); typeContracts.set(tree, captured);
  }
  const usages = [];
  const namespaces = namespacesFor(root, file.path);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = importFile(statement.moduleSpecifier.text, absolute, root);
    if (!target) continue;
    const remote = moduleInfo(target);
    collectTypes(remote.ast);
    const exports = remote.definitions;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const binding of named.elements) {
      const namespace = exports.get(binding.propertyName?.text ?? binding.name.text);
      if (namespace) bindings.set(binding.name.text, namespace);
      // Finite exported arrays/maps are used by navigation, records and filter bars.
      for (const declaration of remote.ast.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === (binding.propertyName?.text ?? binding.name.text) && declaration.initializer) initializers.set(binding.name.text, declaration.initializer);
      }
    }
  }
  collectTypes(ast);
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useTranslations") {
      translators.set(node.name.text, node.initializer.arguments[0]?.text ?? "");
    }
    ts.forEachChild(node, collect);
  };
  collect(ast);
  function translatorNamespace(expression, seen = new Set()) {
    if (!expression || seen.has(expression)) return;
    const next = new Set([...seen, expression]);
    if (ts.isIdentifier(expression)) {
      const declaration = lexicalDeclaration(expression);
      const typed = declaration?.type?.getText().match(/ReturnType<typeof useTranslations<["']([^"']+)["']>>/);
      if (typed) return typed[1];
      return translatorNamespace(declaration?.initializer, next);
    }
    if (ts.isCallExpression(expression)) {
      if (expression.expression.getText() === "useTranslations") return expression.arguments[0]?.text ?? "";
      if (expression.expression.getText() === "useRef") return translatorNamespace(expression.arguments[0], next);
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (["current", "rich", "raw"].includes(expression.name.text)) return translatorNamespace(expression.expression, next);
      const owner = expression.expression;
      if (ts.isPropertyAccessExpression(owner) && owner.name.text === "current" && ts.isIdentifier(owner.expression)) {
        const initializer = lexicalDeclaration(owner.expression)?.initializer;
        const object = initializer && ts.isCallExpression(initializer) && initializer.expression.getText() === "useRef" ? initializer.arguments[0] : undefined;
        if (object && ts.isObjectLiteralExpression(object)) {
          const property = object.properties.find(item => item.name?.getText() === expression.name.text);
          return translatorNamespace(property && ts.isShorthandPropertyAssignment(property) ? property.name : property?.initializer, next);
        }
      }
    }
  }
  function resolveTypes(type, seen = new Set()) {
    if (!type) return [];
    if (type.owner) return resolveTypes(type.owner, seen).flatMap(owner => [...(owner.members ?? [])].filter(member => member.name?.getText().replace(/^['"]|['"]$/g, "") === type.property).flatMap(member => resolveTypes(member.type, seen)));
    if (ts.isTypeReferenceNode(type) && !seen.has(type.typeName.getText())) return resolveTypes(types.get(type.typeName.getText()), new Set([...seen, type.typeName.getText()]));
    if (ts.isUnionTypeNode(type)) return type.types.flatMap(item => resolveTypes(item, seen));
    if (ts.isParenthesizedTypeNode(type)) return resolveTypes(type.type, seen);
    if (ts.isArrayTypeNode(type)) return resolveTypes(type.elementType, seen);
    return [type];
  }
  function expressionTypes(node) {
    if (!node) return [];
    if (ts.isAsExpression(node)) return resolveTypes(node.type);
    if (ts.isIdentifier(node)) {
      const declaration = lexicalDeclaration(node);
      const initializer = declaration?.initializer;
      if (declaration?.type) return resolveTypes(declaration.type);
      if (initializer && ts.isCallExpression(initializer) && initializer.expression.getText() === "useState") return resolveTypes(initializer.typeArguments?.[0]);
      return declaration ? [] : resolveTypes(annotations.get(node.text));
    }
    if (ts.isPropertyAccessExpression(node)) return expressionTypes(node.expression).flatMap(type => [...(type.members ?? [])].filter(member => member.name?.getText().replace(/^['"]|['"]$/g, "") === node.name.text).flatMap(member => resolveTypes(member.type)));
    return [];
  }
  function nodesFor(node, seen = new Set()) {
    if (!node) return [];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return nodesFor(node.expression, seen);
    if (ts.isConditionalExpression(node)) return [...nodesFor(node.whenTrue, seen), ...nodesFor(node.whenFalse, seen)];
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return [...nodesFor(node.left, seen), ...nodesFor(node.right, seen)];
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const next = new Set([...seen, node.text]);
      for (let scope = node.parent; scope; scope = scope.parent) {
        if (ts.isArrowFunction(scope) && scope.parameters[0] && ts.isCallExpression(scope.parent) && ts.isPropertyAccessExpression(scope.parent.expression) && ["map", "filter", "find", "flatMap"].includes(scope.parent.expression.name.text)) {
          const parameter = scope.parameters[0].name;
          if (ts.isArrayBindingPattern(parameter) || ts.isObjectBindingPattern(parameter)) {
            const index = parameter.elements.findIndex(element => ts.isBindingElement(element) && element.name.getText() === node.text);
            if (index >= 0) {
              const items = nodesFor(scope.parent.expression.expression, next).flatMap(value => ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]);
              if (ts.isArrayBindingPattern(parameter)) return items.flatMap(value => ts.isArrayLiteralExpression(value) && value.elements[index] ? [value.elements[index]] : []);
              const key = parameter.elements[index].propertyName?.getText() ?? node.text;
              return items.flatMap(value => ts.isObjectLiteralExpression(value) ? value.properties.filter(prop => ts.isPropertyAssignment(prop) && prop.name.getText().replace(/^['"]|['"]$/g, "") === key).map(prop => prop.initializer) : []);
            }
          }
        }
        if (ts.isArrowFunction(scope) && scope.parameters[0]?.name.getText() === node.text && ts.isCallExpression(scope.parent) && ts.isPropertyAccessExpression(scope.parent.expression) && ["map", "filter", "find", "flatMap"].includes(scope.parent.expression.name.text)) {
          return nodesFor(scope.parent.expression.expression, next).flatMap(value => ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]);
        }
      }
      const declaration = lexicalDeclaration(node);
      return nodesFor(declaration ? declaration.initializer : initializers.get(node.text), next);
    }
    if (ts.isElementAccessExpression(node)) return nodesFor(node.expression, seen).flatMap(value => ts.isArrayLiteralExpression(value) ? [...value.elements] : ts.isObjectLiteralExpression(value) ? value.properties.flatMap(prop => ts.isPropertyAssignment(prop) ? [prop.initializer] : []) : []);
    if (ts.isPropertyAccessExpression(node)) return nodesFor(node.expression, seen).flatMap(value => {
      if (!ts.isObjectLiteralExpression(value)) return [];
      const property = value.properties.find(prop => prop.name?.getText().replace(/^['"]|['"]$/g, "") === node.name.text);
      return property && ts.isPropertyAssignment(property) ? [property.initializer] : [];
    });
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useMemo" && node.arguments[0] && ts.isArrowFunction(node.arguments[0]) && !ts.isBlock(node.arguments[0].body)) return nodesFor(node.arguments[0].body, seen);
    if (ts.isCallExpression(node) && node.expression.getText() === "Object.entries") return nodesFor(node.arguments[0], seen).flatMap(value => ts.isObjectLiteralExpression(value) ? value.properties.filter(ts.isPropertyAssignment).map(prop => ts.factory.createArrayLiteralExpression([prop.name, prop.initializer])) : []);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["filter", "find", "slice"].includes(node.expression.name.text)) return nodesFor(node.expression.expression, seen).flatMap(value => ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !seen.has(node.expression.text)) return (returns.get(node.expression.text) ?? []).flatMap(value => nodesFor(value, new Set([...seen, node.expression.text])));
    return [node];
  }
  const literalKeys = (node, seen = new Set()) => {
    if (!node) return [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...literalKeys(node.whenTrue, seen), ...literalKeys(node.whenFalse, seen)];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalKeys(node.expression, seen);
    if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !seen.has(node.getText())) {
      const values = nodesFor(node).flatMap(value => value === node ? [] : literalKeys(value, new Set([...seen, node.getText()])));
      return values.length ? values : expressionTypes(node).flatMap(type => ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? [type.literal.text] : []);
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(value => literalKeys(value, seen));
    if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(value => ts.isPropertyAssignment(value) ? literalKeys(value.initializer, seen) : []);
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text];
      for (const span of node.templateSpans) {
        const parts = literalKeys(span.expression, seen);
        if (!parts.length) return [];
        values = values.flatMap(value => parts.map(part => value + part + span.literal.text));
      }
      return values;
    }
    return [];
  };
  // These adapters enumerate the finite source contracts behind dynamic UI calls.
  // They read identifiers from code, never from the translated catalog itself.
  function contractKeys(namespace, argument) {
    const normalized = file.path.replaceAll("\\", "/");
    const keys = [];
    const strings = node => {
      if (ts.isStringLiteral(node)) return [node.text];
      return ts.isAsExpression(node) || ts.isParenthesizedExpression(node) ? strings(node.expression) : ts.isArrayLiteralExpression(node) ? node.elements.flatMap(strings) : [];
    };
    const propertyValues = (tree, names) => {
      const values = [];
      const walk = node => {
        if (ts.isPropertyAssignment(node) && names.includes(node.name.getText().replace(/^['"]|['"]$/g, ""))) values.push(...strings(node.initializer));
        ts.forEachChild(node, walk);
      }; walk(tree); return values;
    };
    if (namespace === "records" && /item\.content|^content$/.test(argument.getText(ast))) keys.push(...propertyValues(ast, ["content"]));
    if (namespace === "Account.AuthValidation" && /\/auth\/(password-strength|ResetPasswordForm)\.tsx$/.test(normalized) && argument.getText() === "rule.id") keys.push(...propertyValues(moduleInfo(path.resolve(root, "packages/arknights-domain/src/password-strength.ts")).ast, ["id"]));
    if (namespace === "Account.AuthFeedback" && normalized.includes("/auth/") && argument.getText() === "failure") {
      const definition = moduleInfo(path.resolve(root, "packages/shell/auth/auth-feedback.ts")).ast.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === "AuthFailure");
      if (definition && ts.isUnionTypeNode(definition.type)) for (const type of definition.type.types) if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) keys.push(type.literal.text);
    }
    const sourceTree = relative => moduleInfo(path.resolve(root, relative)).ast;
    const declaration = (tree, name) => tree.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find(node => node.name.getText() === name)?.initializer;
    const typeStrings = (tree, name, member) => {
      const type = tree.statements.find(node => (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === name);
      const target = member ? type?.members?.find(node => node.name?.getText() === member)?.type : type?.type;
      return target && ts.isUnionTypeNode(target) ? target.types.flatMap(node => ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? [node.literal.text] : []) : [];
    };
    const argumentText = argument.getText();
    if (namespace === "AK_Raw_app_wishes_wishes_client" && normalized.endsWith("/wishes-client.tsx") && argumentText === "message") {
      const visit = node => { if (ts.isCallExpression(node) && node.expression.getText() === "setMessage" && node.arguments[0]) keys.push(...literalKeys(node.arguments[0]).filter(Boolean)); ts.forEachChild(node, visit); }; visit(ast);
    }
    if (namespace === "components_pages_MasteryPlanner" && normalized.endsWith("/MasteryPlanner.tsx") && argumentText.startsWith("`environment_${key}`")) keys.push(...Object.keys(JSON.parse(fs.readFileSync(path.resolve(root, "apps/arknights/src/generated/mastery-data.json"), "utf8")).environments).map(key => `environment_${key}`));
    if (namespace === "AdminWorkspace" && normalized.endsWith("/billing/code-history.tsx") && argumentText === "key") {
      const status = declaration(ast, "statusKeys");
      keys.push(...nodesFor(status).flatMap(value => ts.isObjectLiteralExpression(value) ? value.properties.flatMap(prop => ts.isPropertyAssignment(prop) ? strings(prop.initializer) : []) : []));
    }
    if (namespace === "diagnostics" && normalized.endsWith("/diagnostics-panel.tsx") && argumentText === "`categories.${group.category}`") keys.push(...strings(declaration(sourceTree("packages/arknights-domain/src/diagnostics.ts"), "DIAGNOSTIC_CATEGORIES")).map(key => `categories.${key}`));
    if (namespace === "AK_Raw_app_plush_PlushGallery" && normalized.endsWith("/PlushGallery.tsx")) {
      if (argumentText === "`control_${control.key}`") keys.push(...propertyValues(sourceTree("apps/arknights/src/components/agent/fur-settings.ts"), ["key"]).map(key => `control_${key}`));
      if (argumentText === "`performance_${performanceMode}`") keys.push(...typeStrings(sourceTree("apps/arknights/src/components/agent/fur-performance.ts"), "FurPerformanceMode").map(key => `performance_${key}`));
    }
    if (namespace === "AK_components_billing_BillingPrototype" && normalized.endsWith("/BillingPrototype.tsx") && argumentText === "notice.key") keys.push(...propertyValues(ast, ["key"]));
    if (namespace === "MoodSimulation" && normalized.endsWith("/manual-mood/MoodSimulationPanel.tsx") && ["e.kind", "e.reason"].includes(argumentText)) keys.push(...typeStrings(sourceTree("apps/arknights/src/mood-simulation/types.ts"), "MoodEvent", argumentText.slice(2)));
    if (namespace === "AK_components_pages_AccountHealthDemandSection" && normalized.endsWith("/AccountHealthDemandSection.tsx") && argumentText === "field.label") keys.push(...propertyValues(declaration(ast, "FIELDS"), ["label"]));
    if (namespace === "Recruitment" && normalized.endsWith("/RecruitmentCalculator.tsx") && argumentText === "operator.ownership") keys.push(...typeStrings(sourceTree("apps/arknights/src/recruitment.ts"), "RecruitmentOwnership"));
    if (namespace === "SkillTags" && normalized.endsWith("/SkillTagBar.tsx") && argumentText === "tag as keyof typeof messages") keys.push(...propertyValues(declaration(sourceTree("apps/arknights/src/building-rooms.ts"), "ROOM_SKILL_TAGS"), ["control", "power", "manu", "trade", "dorm", "hire", "meet", "train", "workshop", "recycle"]));
    if (namespace === "PosterLabels" && normalized.endsWith("/schedule-poster-model.ts") && argumentText === "recipe") keys.push("gold", "battle_record", "originium", "all");
    if (namespace === "PosterLabels" && normalized.endsWith("/schedule-poster-model.ts") && argumentText === "room.kind") keys.push("recycling");
    if (namespace === "RotationLabels" && normalized.endsWith("/rotation-settings.ts")) {
      keys.push(...propertyValues(ast, ["profile"]));
      const legacy = initializers.get("LEGACY_ROTATION_OPTIONS");
      if (legacy && ts.isObjectLiteralExpression(legacy)) keys.push(...legacy.properties.map(property => property.name.getText().replace(/^['"]|['"]$/g, "")));
    }
    if (normalized.endsWith("/docs/content.ts") && ["Docs", "help_knowledge"].includes(namespace)) {
      if (namespace === "Docs") keys.push(...propertyValues(ast, ["title", "description", "paragraphs", "steps", "label"]).filter(key => !key.startsWith("help:")));
      const knowledgeCalls = node => {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === "knowledge") {
          if (namespace === "Docs") keys.push(...strings(node.arguments[3]));
          else for (const id of strings(node.arguments[0])) keys.push(`${id}Question`, `${id}Answer`);
        }
        ts.forEachChild(node, knowledgeCalls);
      }; knowledgeCalls(ast);
    }
    return keys;
  }
  const add = (namespace, argument, kind = "call", prefix = false) => {
    if (!argument) return;
    const literals = literalKeys(argument);
    const finite = literals.length ? literals : expressionTypes(argument).flatMap(type => ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? [type.literal.text] : []);
    let keys = [...finite, ...contractKeys(namespace, argument)];
    // The empty state is not passed to the translator behind a truthy guard.
    for (let parent = argument.parent; parent; parent = parent.parent) {
      if (ts.isConditionalExpression(parent) && parent.condition.getText() === argument.getText() || ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.left.getText() === argument.getText()) keys = keys.filter(Boolean);
    }
    if (!keys.length) keys = contractKeys(namespace, argument);
    const range = { start: argument.getStart(ast), end: argument.end };
    if (keys.length) for (const key of new Set(keys)) usages.push({ raw: namespace ? `${namespace}.${key}` : key, range, kind, dynamic: prefix ? "prefix" : false });
    else usages.push({ raw: namespace, range, kind, dynamic: "unknown" });
  };
  const visit = node => {
    if (file.path.replaceAll("\\", "/").endsWith("/i18n/metadata.ts") && ts.isPropertyAccessExpression(node) && node.expression.getText() === "source.Metadata") usages.push({ raw: `Metadata.${node.name.text}`, range: { start: node.getStart(), end: node.end }, kind: "accessor", dynamic: false });
    // Explicit fully-qualified keys in data maps are finite references, including
    // currently invalid suffixes. Do not expand an unresolved call to a namespace.
    if (ts.isStringLiteral(node) && namespaces.has(node.text.split(".")[0]) && node.text.includes(".") &&
      (ts.isPropertyAssignment(node.parent) && node.parent.initializer === node || ts.isArrayLiteralExpression(node.parent))) {
      usages.push({ raw: node.text, range: { start: node.getStart(ast), end: node.end }, kind: "accessor", dynamic: false });
    }
    if (ts.isCallExpression(node)) {
      const direct = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) && ["rich", "raw"].includes(node.expression.name.text) ? node.expression.expression.getText(ast) : null;
      // LocalizedText's finite keys are collected at each JSX call site below.
      const translator = translatorNamespace(node.expression);
      if (translator !== undefined && node.arguments[0] && !(file.path.replaceAll("\\", "/").endsWith("/LocalizedText.tsx") && node.arguments[0].getText() === "message")) add(translator, node.arguments[0]);
      if (direct === "pageHead") add("Metadata", node.arguments[1]);
      if (ts.isPropertyAccessExpression(node.expression) && ["text", "rich"].includes(node.expression.name.text)) {
        const namespace = bindings.get(node.expression.expression.getText(ast));
        if (namespace) add(namespace, node.arguments[1]);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "messageRecord") add(file.path.replaceAll("\\", "/").includes("packages/shell/") ? "AccountRecords" : "records", node.arguments[1], "accessor", true);
      if (ts.isIdentifier(node.expression) && node.expression.text === "getCatalog" && ts.isStringLiteral(node.arguments[1]) && !["records", "AccountRecords"].includes(node.arguments[1].text)) {
        usages.push({ raw: node.arguments[1].text, range: { start: node.arguments[1].getStart(ast), end: node.arguments[1].end }, kind: "accessor", dynamic: "prefix" });
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "message" && node.initializer && node.parent.parent.tagName?.getText(ast) === "LocalizedText") {
      add("Static", ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer, "accessor");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { usages };
}

export default function helperScanner(root) {
  return { name: "riic-locale-helpers", runtime: "node", scanners: [{ id: "riic-locale-helpers", runtime: "node", extensions: ["ts", "tsx"], scan: file => scanHelpers(file, root) }] };
}
