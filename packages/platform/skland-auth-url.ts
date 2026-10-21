const SKLAND_UNIVERSAL_LINK = "https://bbs.hycdn.cn/u-link/download.html";
const SKLAND_APP_HOME = "skland://gameCenter";

export function buildSklandAppOpenUrl(): string {
  const universalLink = new URL(SKLAND_UNIVERSAL_LINK);
  universalLink.searchParams.set("schema", SKLAND_APP_HOME);
  return universalLink.toString();
}
