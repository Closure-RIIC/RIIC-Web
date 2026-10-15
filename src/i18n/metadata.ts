import type messages from "../../messages/zh";
export function pageHead(source: { Metadata: Record<keyof typeof messages.Metadata, string> } | undefined, key: keyof typeof messages.Metadata) {
  if (!source) return {};
  return { meta: [{ title: key === "home" ? source.Metadata.siteTitle : `${source.Metadata[key]} \u00b7 ${source.Metadata.siteTitle}` }, { name: "description", content: source.Metadata.description }] };
}
