/** Only the explicitly trusted ingress may supply the client address. It overwrites X-Real-IP. */
export function authIpAddressConfiguration(trustProxy = process.env.BETA_TRUST_PROXY_HEADERS === "1") {
  return { ipAddressHeaders: trustProxy ? ["x-real-ip"] : [] };
}
