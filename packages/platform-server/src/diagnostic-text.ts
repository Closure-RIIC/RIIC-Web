export function diagnosticText(value: unknown): string | null {
  const text = typeof value === "string" ? value.slice(0, 16 * 1024) : null;
  if (!text) return null;
  return text
    .replace(/(\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, "$1[已隐藏敏感值]")
    .replace(/(["']?[A-Za-z0-9_.-]*(?:token|secret|password|passwd|cookie|authorization|database[_-]?url|api[_-]?key|master[_-]?keys?|hmac[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "$1[已隐藏敏感值]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[已隐藏敏感值]@")
    .replace(/\\\\[^\\\s,;]+\\[^\r\n,;]+/g, "[已隐藏服务器路径]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n,，;；]+/g, "[已隐藏服务器路径]")
    .replace(/file:\/\/[^\r\n,，;；]+/gi, "[已隐藏服务器路径]")
    .replace(/(^|[\s(=:])\/(?:[^\r\n,，;；]+\/?)+/gm, "$1[已隐藏服务器路径]");
}
