import type messages from "../../messages/zh";
import type { Route as RootRoute } from "../routes/__root";

export function pageHead(matches: readonly { routeId: string; loaderData?: unknown }[], key: keyof typeof messages.Metadata) {
  // head() types each match with the leaf loader; identify the root before narrowing.
  const bootstrap = matches.find(match => match.routeId === "__root__")?.loaderData as typeof RootRoute.types.loaderData | undefined;
  const source = bootstrap?.messages;
  if (!source) return {};
  return { meta: [{ title: key === "home" ? source.Metadata.siteTitle : `${source.Metadata[key]} \u00b7 ${source.Metadata.siteTitle}` }, { name: "description", content: source.Metadata.description }] };
}
