import { getTranslations } from "next-intl/server";

import { LEGAL_OFFICIAL_ACCOUNT_URL } from "@/legal-policy";

export async function LegalUpdates({ document }: { document: "terms" | "privacy" }) {
  const t = await getTranslations("legal_updates");
  const gacha = await getTranslations("gacha_archive_privacy");
  return <>{t.rich(document, {
    section: (chunks) => <section>{chunks}</section>,
    heading: (chunks) => <h2>{chunks}</h2>,
    paragraph: (chunks) => <p>{chunks}</p>,
    number: (chunks) => <span className="font-number">{chunks}</span>,
    officialAccount: (chunks) => <a href={LEGAL_OFFICIAL_ACCOUNT_URL}>{chunks}</a>,
    repository: (chunks) => <a href="https://github.com/KnightCodeSquareMatrix/RIIC-Web">{chunks}</a>,
    license: (chunks) => <a href="https://polyformproject.org/licenses/noncommercial/1.0.0">{chunks}</a>,
  })}{document === "privacy" && <section><h2>{gacha("title")}</h2><p>{gacha("body")}</p></section>}</>;
}
