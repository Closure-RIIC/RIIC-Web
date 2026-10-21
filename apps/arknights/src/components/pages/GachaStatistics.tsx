import { GACHA_RATING_TITLES, gachaLuck, type analyzeGachaHistory } from "@/gacha-analytics";
import styles from "./GachaStatistics.module.css";

type Analysis = ReturnType<typeof analyzeGachaHistory>;
const average = (value: number | null) => value === null ? "—" : value.toFixed(1);

function RatingLaurel({ mirrored = false }: { mirrored?: boolean }) {
  return <svg className={styles.ratingLaurel} data-mirrored={mirrored || undefined} viewBox="0 0 16 30" aria-hidden="true" focusable="false">
    <path d="M13 28C2 23 1 12 11 2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M10 4C7 3 8 1 12 0C13 2 12 4 10 4ZM7 8C3 7 3 4 4 2C7 3 8 5 7 8ZM5 12C1 11 0 8 1 6C4 7 5 9 5 12ZM4 17C0 15 0 12 0 11C3 12 5 14 4 17ZM6 22C2 21 1 18 1 16C4 17 6 19 6 22ZM10 26C6 27 3 24 3 22C7 22 9 23 10 26ZM7 8C8 5 10 5 13 5C12 8 10 9 7 8ZM5 13C6 10 8 9 11 10C10 13 8 14 5 13ZM5 18C6 14 8 14 10 14C10 17 8 19 5 18ZM7 23C7 19 9 18 11 18C12 21 10 23 7 23ZM11 27C10 24 11 22 13 22C15 25 14 27 11 27Z" fill="currentColor" />
  </svg>;
}

export function GachaRating({ average, scope, currentDraws }: { average: number | null; scope: "current" | "career"; currentDraws?: number }) {
  const saving = scope === "current" && currentDraws === 0;
  const rating = saving ? { label: "屯屯鼠", tone: "lucky" } : gachaLuck(average);
  if (!rating) return scope === "career" ? <>—</> : null;
  return <span data-gacha-current-rating={scope === "current" ? "" : undefined} data-gacha-rating={scope} data-tone={rating.tone}
    aria-label={`${scope === "current" ? "当期" : "生涯"}评分：${rating.label}`} className={styles.rating}
    title={saving ? "当期暂无已保存的寻访记录" : "本站评分规则：评分 = 100 − 六星平均抽数，范围 0–100 分。"}>
    <RatingLaurel />
    <span>{rating.label}</span>
    <RatingLaurel mirrored />
  </span>;
}

export function GachaAnalysisOverview({ analysis }: { analysis: Analysis }) {
  const { kinds, achievements, pityTracks } = analysis;
  const visibleKinds = kinds.filter((kind) => ["standard", "limited", "classic"].includes(kind.id) || kind.draws > 0);
  const hasCategoryNotes = visibleKinds.some((kind) => kind.unknownSixCount > 0);
  return <section aria-label="寻访生涯分析" className={styles.analysis} data-gacha-analysis>
    <div className={styles.overview + " infra-room-surface"}>
      <div className={styles.categories}>
        {visibleKinds.map((kind) => <article key={kind.id} data-gacha-kind={kind.id} className={styles.category}>
          <div className={styles.categoryHeading}>
            <h4>{kind.label.replace("寻访", "")}</h4>
            <p className={styles.drawCount}><strong className="font-number">{kind.draws.toLocaleString("zh-CN")}</strong><span>抽</span></p>
          </div>
          <dl className={styles.categoryMetrics}>
            <div><dd><span>{kind.sixCount}</span>{kind.id !== "classic" && <><span className={styles.slash}> / </span><span className={styles.offCount}>{kind.offCount}</span></>}</dd><dt>{kind.id === "classic" ? "出卡数" : "出卡 / 歪"}</dt></div>
            <div><dd>{average(kind.id === "classic" || kind.id === "other" ? kind.sixAverage : kind.upAverage)}</dd><dt>{kind.id === "classic" || kind.id === "other" ? "六星平均" : "UP 平均"}</dt></div>
          </dl>
          {hasCategoryNotes && <p className={styles.categoryNote} aria-hidden={kind.unknownSixCount === 0 || undefined}>{kind.unknownSixCount > 0 ? `${kind.unknownSixCount} 位 UP 未判定` : "\u00a0"}</p>}
        </article>)}
      </div>
      {(achievements.multiSix.length > 0 || achievements.longestUpStreak >= 2 || achievements.fullSparks > 0) && <div className={styles.achievements} aria-label="寻访成就">
        {achievements.multiSix.map(([count, batches]) => <span key={count} data-gacha-achievement="multi-six" data-tone="green">十连{["", "", "二", "三", "四", "五", "六", "七", "八", "九", "十"][count]}金 ×{batches}</span>)}
        {achievements.longestUpStreak >= 2 && <span data-gacha-achievement="up-streak" data-tone="green" title="同一卡池连续获得 UP 六星，歪卡或未知 UP 名单会中断">连续 UP ×{achievements.longestUpStreak}</span>}
        {achievements.fullSparks > 0 && <span data-gacha-achievement="full-spark" data-tone="red" title="每个限定卡池单独按已保存抽数满 300 抽计一井，再汇总；不代表实际兑换次数">抽满{achievements.fullSparks === 1 ? "一" : achievements.fullSparks}井</span>}
      </div>}
    </div>
    <div className={styles.pityPanel} aria-label="当前垫抽" data-gacha-pity>
      {pityTracks.map((track) => <div key={track.id} className={styles.pityItem} data-gacha-pity-kind={track.id}>
        <h4>{track.label}</h4>
        <div className={styles.pityBar}>
          <span aria-hidden="true" className={styles.pityFill} style={{ width: ((track.count === null ? 0 : Math.min(99, track.count)) / 99 * 100) + "%" }} />
          <span className={styles.pityValue}>{track.count === null ? "—" : (track.atLeast ? "≥ " : "") + track.count + "/99"}</span>
        </div>
        <p className={track.probability === null ? styles.pityNote : styles.pityProbability}>{track.probability === null ? track.note : <><span className={styles.pityProbabilityLabel}>{track.atLeast ? "概率至少 " : "当前概率 "}</span><b>{track.atLeast ? "≥ " : ""}{track.probability}%</b></>}</p>
      </div>)}
    </div>
  </section>;
}

export function GachaAnalysisRules({ analysis }: { analysis: Analysis }) {
  const { career } = analysis;
  return <details className={styles.rules} data-gacha-rules>
      <summary>统计口径 · 本站评分</summary>
      <p><strong>本站评分规则：</strong>评分 = 100 − 六星平均抽数，范围 0–100 分。未出六星时暂不评分，当期评分只包括仍在开放的卡池记录，不代表整个游戏版本。评分不表示玩家排名，也不预测下一抽。</p>
      <p>玩家名字旁展示当期称号，按未四舍五入的评分每 10 分一档，等级如下：{GACHA_RATING_TITLES.map((title, index) => `${index * 10}–${index === 9 ? "100" : `不足 ${(index + 1) * 10}`} 分「${title}」`).join("；")}。当期没有已保存的寻访记录时显示绿色“屯屯鼠”；当期已抽但未出六星时暂不显示评分称号。</p>
      <p>生涯评分采用相同称号，统计全部已保存记录。当期与生涯称号统一配色：0–不足 40 分为红色，40–不足 60 分为黄色，60–100 分为绿色；未出六星时生涯评分显示“—”。</p>
      <p>六星平均统计至最近一次出六星，剔除末尾尚未出六星的垫抽，再除以六星次数；标准、中坚按各自共享保底合并，限定、联动和特殊池分别结算。UP 平均按每个卡池统计至最近一次出 UP，剔除之后尚未出 UP 的抽数，再以有效抽数合计 ÷ UP 六星次数计算；未出 UP 的卡池不参与平均。最早一段可能只有部分记录，平均值仅反映已保存历史。</p>
      <p>限定统计包含联动池，两者各自按卡池结算、不共享保底。出卡数包含重复六星；歪卡是该期明确 UP 名单之外的六星，自选 UP 未保存或名单缺失时标为“未判定”。中坚分类卡片展示六星平均。生涯可判定歪卡率为 {career.offRate === null ? "—" : (career.offRate * 100).toFixed(1) + "%"}。</p>
      <p>垫抽仅在顶部集中展示：标准、中坚各自跨池继承，限定只显示进行中卡池且不跨期继承。未找到上一位六星用“≥”表示下限，记录缺失时无法还原准确保底。已垫 0–49 抽时下一抽六星基础概率为 2%，已垫 50 抽时为 4%，此后每抽增加 2%，第 99 抽达到 100%。概率是游戏基础递增规则，不计目标干员选调等特殊保证。</p>
      <p>绿色成就统计完整十连的多金批次和同池连续 UP 六星。红色“抽满一井”按每个限定卡池已保存记录每满 300 抽计一井，再汇总；不足 300 抽的尾数不跨池相加，标准、中坚、联动和特殊池不计入。这只是抽数成就，不代表实际兑换次数，也不推断账号干员潜能。</p>
    </details>;
}
