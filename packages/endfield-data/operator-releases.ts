// First availability on CN servers, not character IDs, data-table sortOrder,
// or rerun dates. Keep this separate from the generated artwork catalog.
export const operatorReleases = [
  {
    releasedOn: "2026-10-15",
    source: "https://endfield.hypergryph.com/news/6094",
    operatorIds: ["chr_0036_jsspsi"],
  },
  {
    releasedOn: "2026-09-24",
    source: "https://endfield.hypergryph.com/news/2653",
    operatorIds: ["chr_0038_purrche"],
  },
  {
    releasedOn: "2026-09-02",
    source: "https://endfield.hypergryph.com/news/2653",
    operatorIds: ["chr_0034_typhoea"],
  },
  {
    releasedOn: "2026-08-09",
    source: "https://endfield.hypergryph.com/news/9335",
    operatorIds: ["chr_0035_liino"],
  },
  {
    releasedOn: "2026-07-16",
    source: "https://endfield.hypergryph.com/news/9335",
    operatorIds: ["chr_0032_lizhiyan"],
  },
  {
    releasedOn: "2026-06-26",
    source: "https://endfield.hypergryph.com/news/0439",
    operatorIds: ["chr_0033_camille"],
  },
  {
    releasedOn: "2026-06-05",
    source: "https://endfield.hypergryph.com/news/0439",
    operatorIds: ["chr_0031_mifu"],
  },
  {
    releasedOn: "2026-04-17",
    source: "https://endfield.hypergryph.com/news/9343",
    operatorIds: ["chr_0030_zhuangfy"],
  },
  {
    releasedOn: "2026-03-29",
    source: "https://endfield.hypergryph.com/news/6003",
    operatorIds: ["chr_0028_wulfa"],
  },
  {
    releasedOn: "2026-03-12",
    source: "https://endfield.hypergryph.com/news/6003",
    operatorIds: ["chr_0027_tangtang"],
  },
  {
    releasedOn: "2026-01-22",
    source: "https://endfield.hypergryph.com/news/1188",
    // Gilberta and Yvonne were already obtainable in the launch banner,
    // before their own featured banners opened.
    operatorIds: [
      "chr_0002_endminm", "chr_0003_endminf", "chr_0004_pelica", "chr_0005_chen",
      "chr_0006_wolfgd", "chr_0007_ikut", "chr_0009_azrila", "chr_0011_seraph",
      "chr_0012_avywen", "chr_0013_aglina", "chr_0014_aurora", "chr_0015_lifeng",
      "chr_0016_laevat", "chr_0017_yvonne", "chr_0018_dapan", "chr_0019_karin",
      "chr_0020_meurs", "chr_0021_whiten", "chr_0022_bounda", "chr_0023_antal",
      "chr_0024_deepfin", "chr_0025_ardelia", "chr_0026_lastrite", "chr_0029_pograni",
    ],
  },
];

const releaseDates = new Map(operatorReleases.flatMap(release =>
  release.operatorIds.map(id => [id, release.releasedOn] as const)));

// Equal dates retain the existing catalog order; unknown dates stay at the end.
export function compareOperatorRelease(a: { id: string }, b: { id: string }): number {
  const aDate = releaseDates.get(a.id) ?? "";
  const bDate = releaseDates.get(b.id) ?? "";
  return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
}
