type MessageRoute = { route: string; module: string };

/** Select the matching leaf and its real parents, including pathless layouts. */
export function routeMessageNamespaces(pathname: string, routes: readonly MessageRoute[], features: Record<string, readonly string[]>, root: readonly string[]): string[] {
  const actual = pathname.split("/").filter(Boolean);
  const partsFor = (route: string) => route.split("/").filter(part => part && !part.startsWith("_"));
  const specificity = (route: string) => partsFor(route).reduce((score, part) => score + (part === "$" ? -10 : part.startsWith("$") ? 1 : 10), route.endsWith("/") ? 2 : 0);
  const leaves = routes.filter(entry => {
    const parts = partsFor(entry.route);
    if (parts.at(-1) !== "$" && parts.length !== actual.length) return false;
    if (parts.at(-1) === "$" && actual.length < parts.length - 1) return false;
    return parts.every((part, index) => part.startsWith("$") || part.replace(/_$/, "") === actual[index]);
  }).sort((a, b) => specificity(b.route) - specificity(a.route) || b.route.length - a.route.length);
  const leaf = leaves[0];
  const result = new Set(root);
  if (leaf) for (const entry of routes) {
    if (entry === leaf || (!entry.route.endsWith("/") && leaf.route.startsWith(`${entry.route}/`))) {
      for (const namespace of features[entry.module] ?? []) result.add(namespace);
    }
  }
  return [...result];
}
