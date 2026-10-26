import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { Check, Search } from "lucide-react";
import {
  DEFENSE_PORTRAITS,
  defensePortraitUrl,
  findDefensePortrait,
  searchDefensePortraits,
  type DefensePortrait,
} from "../../defense-portraits";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import styles from "./DefensePortraitPicker.module.css";

const PAGE_SIZE = 36;
export function DefensePortraitPicker({ value, onChange, disabled }: {
  value: DefensePortrait;
  onChange: (value: DefensePortrait) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("DefenseTeam");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const results = useMemo(() => searchDefensePortraits(query), [query]);
  const selected = findDefensePortrait(value);
  const legacy = DEFENSE_PORTRAITS.find((portrait) => portrait === value) ?? "default";
  const selectedName = selected?.name ?? t(`portrait_${legacy}`);
  return (
    <section className={styles.picker} aria-labelledby="defense-portrait-heading">
      <h3 id="defense-portrait-heading">{t("portraitTitle")}</h3>
      <p className={styles.hint}>{t("portraitHint")}</p>
      <div className={styles.layout}>
        <figure className={styles.preview}>
          <img key={value} src={defensePortraitUrl(value)} alt={selectedName} decoding="async" />
          <figcaption><Check size={14} aria-hidden />{selectedName}</figcaption>
          <span>{t("portraitSelected")}</span>
        </figure>
        <div className={styles.catalogue}>
          <label className={styles.searchLabel} htmlFor="defense-portrait-search">{t("portraitSearch")}</label>
          <div className={styles.search}>
            <Search size={16} aria-hidden />
            <Input id="defense-portrait-search" type="search" maxLength={80}
              placeholder={t("portraitSearchPlaceholder")} value={query} disabled={disabled}
              onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} />
          </div>
          <div className={styles.legacy} role="group" aria-label={t("portraitOriginals")}>
            {DEFENSE_PORTRAITS.map((portrait) => (
              <Button key={portrait} type="button" variant="outline" disabled={disabled}
                aria-pressed={value === portrait} onClick={() => onChange(portrait)}>
                {t(`portrait_${portrait}`)}
              </Button>
            ))}
          </div>
          <p role="status" className={styles.count}>{t("portraitCount", { count: results.length })}</p>
          <div className={styles.grid} role="group" aria-label={t("portraitOperators")}>
            {results.slice(0, limit).map((operator) => (
              <button key={operator.id} type="button" aria-pressed={value === operator.id}
                title={operator.name} disabled={disabled}
                onClick={() => onChange(operator.id as DefensePortrait)}>
                <img src={operator.thumbnail} alt="" loading="lazy" decoding="async" width={72} height={88} />
                <span>{operator.name}</span>
                {value === operator.id ? <Check className={styles.check} size={15} aria-hidden /> : null}
              </button>
            ))}
            {!results.length ? <p className={styles.empty}>{t("portraitNoResults")}</p> : null}
          </div>
          {results.length > limit ? (
            <Button type="button" variant="ghost" className={styles.more} disabled={disabled}
              onClick={() => setLimit((current) => current + PAGE_SIZE)}>{t("portraitLoadMore")}</Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
