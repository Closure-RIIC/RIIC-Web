export function isForbiddenNativeAdminPath(url: string): boolean {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  return pathname === "/api/auth/admin" || pathname.startsWith("/api/auth/admin/");
}
