import path from "node:path";

export function isPrivateStorageChild(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function isSafePrivateStorageRoot(root: string, disallowedRoots: string[] = []): boolean {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) return false;
  return disallowedRoots.every((candidate) => {
    const resolvedCandidate = path.resolve(candidate);
    return resolvedCandidate !== resolved && !isPrivateStorageChild(resolved, resolvedCandidate);
  });
}

export function isLegacySklandRunDirectoryName(name: string): boolean {
  const normalized = name.toLocaleLowerCase("en-US");
  return normalized.includes("_森空岛同步_") || normalized.includes("_skland_");
}
