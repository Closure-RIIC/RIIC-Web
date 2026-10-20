export type GameId = "arknights" | "endfield";

/** Fixed destinations only. Never carry game routes, tokens or query strings across apps. */
export function gameHref(game: GameId, currentOrigin?: string, override?: string): string {
  if (override) {
    const url = new URL(override);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Game URL must be an origin");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Game URL must use HTTPS");
    return `${url.origin}/`;
  }
  if (currentOrigin) {
    const current = new URL(currentOrigin);
    if (["127.0.0.1", "localhost"].includes(current.hostname)) {
      current.port = game === "arknights" ? "5175" : "5176";
      return `${current.origin}/`;
    }
  }
  return game === "endfield" ? "https://endfield.riic.autos/" : "https://riic.autos/";
}
