import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_pages_GachaStatistics.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_pages_GachaStatistics");
import { GACHA_RATING_TITLES, gachaLuck, type analyzeGachaHistory } from "@/gacha-analytics";
import styles from "./GachaStatistics.module.css";

import type { AppLocale } from "@riic/contracts/locale";
const ratingKeys = ["rating0","rating1","rating2","rating3","rating4","rating5","rating6","rating7","rating8","rating9"] as const;
const kindKeys = { standard: "kind_standard", limited: "kind_limited", classic: "kind_classic", linkage: "kind_linkage", other: "kind_other" } as const;
const pityKeys: Record<string, keyof typeof RawMessages> = {"限定已垫":"pityLimited","标准已垫":"pityStandard","中坚已垫":"pityClassic","暂无进行中的限定池":"noLimited","本期独立累计":"independent","未保存本期记录":"noCurrentRecords","同类卡池共享":"shared","未保存记录":"noRecords"};
function ratingTitle(title: string, locale: AppLocale) {
  const index = (GACHA_RATING_TITLES as readonly string[]).indexOf(title);
  return index >= 0 ? rawText.text(locale, ratingKeys[index]) : title;
}
function pityText(value: string, locale: AppLocale) { return pityKeys[value] ? rawText.text(locale, pityKeys[value]) : value; }

type Analysis = ReturnType<typeof analyzeGachaHistory>;
const average = (value: number | null) => value === null ? "—" : value.toFixed(1);

function RatingLaurel({ mirrored = false }: { mirrored?: boolean }) {
  return <svg className={styles.ratingLaurel} data-mirrored={mirrored || undefined} viewBox="0 0 16 30" aria-hidden="true" focusable="false">
    <path d="M13 28C2 23 1 12 11 2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M10 4C7 3 8 1 12 0C13 2 12 4 10 4ZM7 8C3 7 3 4 4 2C7 3 8 5 7 8ZM5 12C1 11 0 8 1 6C4 7 5 9 5 12ZM4 17C0 15 0 12 0 11C3 12 5 14 4 17ZM6 22C2 21 1 18 1 16C4 17 6 19 6 22ZM10 26C6 27 3 24 3 22C7 22 9 23 10 26ZM7 8C8 5 10 5 13 5C12 8 10 9 7 8ZM5 13C6 10 8 9 11 10C10 13 8 14 5 13ZM5 18C6 14 8 14 10 14C10 17 8 19 5 18ZM7 23C7 19 9 18 11 18C12 21 10 23 7 23ZM11 27C10 24 11 22 13 22C15 25 14 27 11 27Z" fill="currentColor" />
  </svg>;
}

export function GachaRating({ average, scope, currentDraws }: { average: number | null; scope: "current" | "career"; currentDraws?: number }) {
  const rawLocale = useRawLocale();
  const saving = scope === "current" && currentDraws === 0;
  const rating = saving ? { label: rawText.text(rawLocale, "saving"), tone: "lucky" } : gachaLuck(average);
  if (!rating) return scope === "career" ? <>—</> : null;
  const label = saving ? rating.label : ratingTitle(rating.label, rawLocale);
  return <span data-gacha-current-rating={scope === "current" ? "" : undefined} data-gacha-rating={scope} data-tone={rating.tone}
    aria-label={rawText.text(rawLocale, "ratingLabel", { scope, label })} className={styles.rating}
    title={rawText.text(rawLocale, saving ? "noCurrent" : "ratingRule")}>
    <RatingLaurel />
    <span>{label}</span>
    <RatingLaurel mirrored />
  </span>;
}

export function GachaAnalysisOverview({ analysis }: { analysis: Analysis }) {
  const rawLocale = useRawLocale();
  const { kinds, achievements, pityTracks } = analysis;
  const visibleKinds = kinds.filter((kind) => ["standard", "limited", "classic"].includes(kind.id) || kind.draws > 0);
  const hasCategoryNotes = visibleKinds.some((kind) => kind.unknownSixCount > 0);
  return <section aria-label={rawText.text(rawLocale, "lifetimeHeadhuntingAnalysis")} className={styles.analysis} data-gacha-analysis>
    <div className={styles.overview + " infra-room-surface"}>
      <div className={styles.categories}>
        {visibleKinds.map((kind) => <article key={kind.id} data-gacha-kind={kind.id} className={styles.category}>
          <div className={styles.categoryHeading}>
            <h4>{rawText.text(rawLocale, kindKeys[kind.id])}</h4>
            <p className={styles.drawCount}><strong className="font-number">{kind.draws.toLocaleString(rawLocale)}</strong><span>{rawText.text(rawLocale, "pulls")}</span></p>
          </div>
          <dl className={styles.categoryMetrics}>
            <div><dd><span>{kind.sixCount}</span>{kind.id !== "classic" && <><span className={styles.slash}> / </span><span className={styles.offCount}>{kind.offCount}</span></>}</dd><dt>{kind.id === "classic" ? rawText.text(rawLocale, "6Count") : rawText.text(rawLocale, "6OffBanner")}</dt></div>
            <div><dd>{average(kind.id === "classic" || kind.id === "other" ? kind.sixAverage : kind.upAverage)}</dd><dt>{kind.id === "classic" || kind.id === "other" ? rawText.text(rawLocale, "averagePullsPer6") : rawText.text(rawLocale, "averagePullsPerRateUp")}</dt></div>
          </dl>
          {hasCategoryNotes && <p className={styles.categoryNote} aria-hidden={kind.unknownSixCount === 0 || undefined}>{kind.unknownSixCount > 0 ? rawText.text(rawLocale, "unknownUp", { count: kind.unknownSixCount }) : "\u00a0"}</p>}
        </article>)}
      </div>
      {(achievements.multiSix.length > 0 || achievements.longestUpStreak >= 2 || achievements.fullSparks > 0) && <div className={styles.achievements} aria-label={rawText.text(rawLocale, "headhuntingAchievements")}>
        {achievements.multiSix.map(([count, batches]) => <span key={count} data-gacha-achievement="multi-six" data-tone="green">{rawText.rich(rawLocale, "sixStarsInATenPull", { part1: richValue((count.toLocaleString(rawLocale))), part2: richValue((batches)) })}</span>)}
        {achievements.longestUpStreak >= 2 && <span data-gacha-achievement="up-streak" data-tone="green" title={rawText.text(rawLocale, "consecutiveRateUp6OperatorsOnTheSameBanner")}>{rawText.rich(rawLocale, "rateUpStreak", { part1: richValue((achievements.longestUpStreak)) })}</span>}
        {achievements.fullSparks > 0 && <span data-gacha-achievement="full-spark" data-tone="red" title={rawText.text(rawLocale, "each300SavedPullsOnAnIndividualLimitedBanner")}>{rawText.rich(rawLocale, "sparksReached", { part1: richValue((achievements.fullSparks.toLocaleString(rawLocale))) })}</span>}
      </div>}
    </div>
    <div className={styles.pityPanel} aria-label={rawText.text(rawLocale, "currentPityCount")} data-gacha-pity>
      {pityTracks.map((track) => <div key={track.id} className={styles.pityItem} data-gacha-pity-kind={track.id}>
        <h4>{pityText(track.label, rawLocale)}</h4>
        <div className={styles.pityBar}>
          <span aria-hidden="true" className={styles.pityFill} style={{ width: ((track.count === null ? 0 : Math.min(99, track.count)) / 99 * 100) + "%" }} />
          <span className={styles.pityValue}>{track.count === null ? "—" : (track.atLeast ? "≥ " : "") + track.count + "/99"}</span>
        </div>
        <p className={track.probability === null ? styles.pityNote : styles.pityProbability}>{track.probability === null ? pityText(track.note, rawLocale) : <><span className={styles.pityProbabilityLabel}>{track.atLeast ? rawText.text(rawLocale, "probabilityAtLeast") : rawText.text(rawLocale, "currentProbability")}</span><b>{track.atLeast ? "≥ " : ""}{track.probability}%</b></>}</p>
      </div>)}
    </div>
  </section>;
}

export function GachaAnalysisRules({ analysis }: { analysis: Analysis }) {
  const rawLocale = useRawLocale();
  const { career } = analysis;
  return <details className={styles.rules} data-gacha-rules>
      <summary>{rawText.text(rawLocale, "methodologySiteScore")}</summary>
      <p>{rawText.rich(rawLocale, "score100AveragePullsPer6ClampedTo0", { part1: richValue((<strong>{rawText.text(rawLocale, "siteScoringRules")}</strong>)) })}</p>
      <p>{rawText.rich(rawLocale, "theTitleBesideThePlayerNameUsesTheCurrent", { part1: richValue((GACHA_RATING_TITLES.map((title, index) => rawText.text(rawLocale, "ratingBand", { from: index * 10, upper: index === 9 ? "100" : rawText.text(rawLocale, "under", { value: (index + 1) * 10 }), title: ratingTitle(title, rawLocale) })).join("；"))) })}</p>
      <p>{rawText.text(rawLocale, "lifetimeScoresUseTheSameTitlesAndAllSaved")}</p>
      <p>{rawText.text(rawLocale, "averagePullsPer6CountsThroughTheLatest6")}</p>
      <p>{rawText.rich(rawLocale, "limitedStatisticsIncludeCrossoverBannersButEachBannerIs", { part1: richValue((career.offRate === null ? "—" : (career.offRate * 100).toFixed(1) + "%")) })}</p>
      <p>{rawText.text(rawLocale, "pityCountsAppearOnlyAtTheTopStandardAnd")}</p>
      <p>{rawText.text(rawLocale, "greenAchievementsCountMulti6ResultsInCompleteTen")}</p>
    </details>;
}
