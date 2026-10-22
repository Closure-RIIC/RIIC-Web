export function sharedSessionConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.PLATFORM_PUBLIC_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  const origins = configured.map(value => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== value || url.username || url.password || (url.protocol !== "https:" && !(environment.NODE_ENV !== "production" && local && url.protocol === "http:"))) {
      throw new Error("PLATFORM_PUBLIC_ORIGINS must contain exact HTTPS origins");
    }
    return url.origin;
  });
  const domain = environment.AUTH_COOKIE_DOMAIN?.trim().toLowerCase().replace(/^\./, "");
  if (domain && (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*\.[a-z0-9-]+$/.test(domain) || origins.length < 2 || origins.some(value => {
    const url = new URL(value);
    return url.protocol !== "https:" || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`));
  }))) throw new Error("AUTH_COOKIE_DOMAIN requires at least two explicitly trusted HTTPS origins in that domain");
  return { origins: [...new Set(origins)], domain };
}

export function sessionCookieDomain(request: Request): string | undefined {
  const { domain, origins } = sharedSessionConfiguration();
  return domain && origins.includes(new URL(request.url).origin) ? domain : undefined;
}
