import { useTranslations } from "use-intl";

import { LEGAL_OFFICIAL_ACCOUNT_URL } from "@riic/arknights-domain/legal-policy";

export function LegalUpdates({ document }: { document: "terms" | "privacy" }) {
  const t = useTranslations("legal_updates");
  const gacha = useTranslations("gacha_archive_privacy");
  return <>{t.rich(document, {
    section: (chunks) => <section>{chunks}</section>,
    heading: (chunks) => <h2>{chunks}</h2>,
    paragraph: (chunks) => <p>{chunks}</p>,
    number: (chunks) => <span className="font-number">{chunks}</span>,
    officialAccount: (chunks) => <a href={LEGAL_OFFICIAL_ACCOUNT_URL}>{chunks}</a>,
    repository: (chunks) => <a href="https://github.com/Closure-RIIC/RIIC-Web">{chunks}</a>,
    license: (chunks) => <a href="https://polyformproject.org/licenses/noncommercial/1.0.0">{chunks}</a>,
  })}{document === "privacy" && <section><h2>{gacha("title")}</h2><p>{gacha("body")}</p></section>}</>;
}
