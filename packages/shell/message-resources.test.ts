import assert from "node:assert/strict";
import test from "node:test";
import { createMessageResources } from "./message-resources.ts";
import { routeMessageNamespaces } from "./route-resources.ts";

test("feature resources deduplicate concurrent requests, isolate locales and retry failures", async () => {
  let requests = 0;
  let fail = true;
  const resources = createMessageResources(async (locale, namespaces) => {
    requests++;
    if (locale === "en" && fail) throw new Error("offline");
    return Object.fromEntries(namespaces.map(name => [name, { locale }]));
  });
  resources.seed("zh-CN", { Common: { label: "简体" } });
  assert.equal(resources.read("zh-CN", ["Common"])?.Common.label, "简体");
  assert.equal(resources.read("zh-TW", ["Common"]), undefined);
  const first = resources.load("zh-TW", ["Roster", "Common"]);
  assert.equal(first, resources.load("zh-TW", ["Common", "Roster"]));
  await first;
  assert.equal(resources.request("zh-TW", ["Roster", "Common"]), first);
  assert.equal(resources.request("zh-CN", ["Common"]), undefined);
  assert.equal(requests, 1);
  await assert.rejects(resources.load("en", ["Common"]), /offline/);
  fail = false;
  await resources.load("en", ["Common"]);
  assert.equal(resources.read("en", ["Common"])?.Common.locale, "en");
  assert.equal(resources.read("zh-CN", ["Common"])?.Common.label, "简体");
  assert.deepEqual(resources.requested().sort(), ["Common", "Roster"]);
});

test("page resources include only the matching pathless layout and page", () => {
  const routes = [{ route: "/_workbench", module: "shell" }, { route: "/_workbench/", module: "home" }, { route: "/_workbench/manual", module: "manual" }, { route: "/admin", module: "admin" }, { route: "/admin/users", module: "users" }];
  const features = { shell: ["Navigation"], home: ["Schedule"], manual: ["Manual"], admin: ["Admin"], users: ["Users"] };
  assert.deepEqual(routeMessageNamespaces("/", routes, features, ["Common"]), ["Common", "Navigation", "Schedule"]);
  assert.deepEqual(routeMessageNamespaces("/manual", routes, features, ["Common"]), ["Common", "Navigation", "Manual"]);
  assert.deepEqual(routeMessageNamespaces("/admin/users", routes, features, ["Common"]), ["Common", "Admin", "Users"]);
  assert.deepEqual(routeMessageNamespaces("/missing", routes, features, ["Common"]), ["Common"]);
});

test("static pages and index pages take precedence over params and splats", () => {
  const routes = [{ route: "/docs", module: "layout" }, { route: "/docs/", module: "index" }, { route: "/docs/$longParameter", module: "article" }, { route: "/docs/$", module: "splat" }, { route: "/docs/new", module: "new" }];
  const features = Object.fromEntries(routes.map(route => [route.module, [route.module]]));
  assert.deepEqual(routeMessageNamespaces("/docs", routes, features, []), ["layout", "index"]);
  assert.deepEqual(routeMessageNamespaces("/docs/new", routes, features, []), ["layout", "new"]);
  assert.deepEqual(routeMessageNamespaces("/docs/guide", routes, features, []), ["layout", "article"]);
  assert.deepEqual(routeMessageNamespaces("/docs/guide/deep", routes, features, []), ["layout", "splat"]);
});
