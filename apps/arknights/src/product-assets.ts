import sourceManifestJson from "./generated/arkntools/source.json" with { type: "json" };

type ProductAssetId = "lmd_orders" | "gold" | "experience" | "originium_shard" | "orundum" | "drone";
type ProductAssetSource = "arkntools" | "game-resource";

interface ProductAssetManifest {
  version: number;
  source: { commit: string };
  portraitsSource: { commit: string };
  products: Array<{
    id: ProductAssetId;
    output: string;
    source: ProductAssetSource;
  }>;
}

const sourceManifest = sourceManifestJson as ProductAssetManifest;

function productAssetUrl(id: ProductAssetId): string {
  const asset = sourceManifest.products.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Missing managed product asset: ${id}`);
  const commit = asset.source === "arkntools"
    ? sourceManifest.source.commit
    : sourceManifest.portraitsSource.commit;
  return `${asset.output}?v=${sourceManifest.version}-${commit.slice(0, 12)}`;
}

export const PRODUCT_ICON_URLS = {
  lmdOrders: productAssetUrl("lmd_orders"),
  gold: productAssetUrl("gold"),
  experience: productAssetUrl("experience"),
  shards: productAssetUrl("originium_shard"),
  orundum: productAssetUrl("orundum"),
  drone: productAssetUrl("drone"),
} as const;

export const ALL_PRODUCT_ICON_URLS = Object.values(PRODUCT_ICON_URLS);
const productIconPreloads = new Map<string, HTMLImageElement>();

export function preloadProductIcons(): void {
  if (typeof window === "undefined") return;
  for (const href of ALL_PRODUCT_ICON_URLS) {
    if (productIconPreloads.has(href)) continue;
    const image = new window.Image();
    image.decoding = "async";
    image.fetchPriority = "low";
    image.src = href;
    productIconPreloads.set(href, image);
  }
}
