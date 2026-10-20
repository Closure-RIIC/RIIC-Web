export function requireAuthSecret(value = process.env.BETTER_AUTH_SECRET): string {
  const secret = value?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

export function configuredAdminIds(value = process.env.BETTER_AUTH_ADMIN_USER_IDS): Set<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

/** Accept the two loopback names for the same dev server, never arbitrary origins. */
export function localAuthTrustedOrigins(
  baseURL: string,
  nodeEnv = process.env.NODE_ENV,
  deploymentEnv = process.env.APP_DEPLOYMENT_ENV,
): string[] {
  if (nodeEnv !== "development" || deploymentEnv === "production") return [];
  const url = new URL(baseURL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) return [];
  return ["localhost", "127.0.0.1"].map((hostname) => {
    const alias = new URL(url);
    alias.hostname = hostname;
    return alias.origin;
  });
}

export function requireAuthBaseUrl(
  value = process.env.BETTER_AUTH_URL,
  deploymentEnv = process.env.APP_DEPLOYMENT_ENV ?? process.env.NODE_ENV,
): string {
  const configured = value?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid HTTP(S) origin.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BETTER_AUTH_URL must be a valid HTTP(S) origin.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && (deploymentEnv === "production" || !local)) {
    throw new Error("BETTER_AUTH_URL must use HTTPS outside local development.");
  }
  return url.origin;
}
