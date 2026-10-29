import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../messages/zh-CN/EF_Raw_components_SiteFooter.json";
const rawText = createRawLocalizer<typeof RawMessages>("EF_Raw_components_SiteFooter");
import { useEffect, useState } from "react";
import { gameHref } from "@riic/shell/games";
import { FilingLinks } from "@riic/shell/FilingLinks";
import { useWorkspace } from "../state";

export function SiteFooter() {
  const rawLocale = useRawLocale();
  const { locale, colorMode, t } = useWorkspace();
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(location.origin), []);
  const main = gameHref("arknights", origin, import.meta.env.VITE_ARKNIGHTS_ORIGIN);

  return (
    <footer className="ef-site-footer workbench-footer">
      <nav className="ef-footer-links" aria-label={t("SiteFooter.siteInformation")}>
        <a href={`${main}terms`}>{t("SiteFooter.termsOfService")}</a>
        <a href={`${main}privacy`}>{t("SiteFooter.privacyPolicy")}</a>
        <a href={`${main}about`} data-about-link>{t("SiteFooter.aboutUs")}</a>
        <a href={`${main}wishes`} data-wishes-link>{t("SiteFooter.wishes")}</a>
      </nav>
      <div className="ef-footer-details">
        <FilingLinks />
        <span className="ef-footer-divider" aria-hidden="true" />
        <a
          href="https://www.rainyun.com/riic_"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("SiteFooter.cloudServicesProvidedByRainyunOpensInANew")}
          className="ef-footer-sponsor"
          data-rainyun-link
        >
          <span data-rainyun-copy>{t("SiteFooter.poweredBy")}</span>
          <img
            src={colorMode === "dark" ? "/images/partners/rainyun-logo-white.png" : "/images/partners/rainyun-logo.png"}
            alt=""
            width={colorMode === "dark" ? 1717 : 1120}
            height={colorMode === "dark" ? 554 : 390}
            decoding="async"
          />
          {locale !== "en" ? <span>{rawText.text(rawLocale, "cloudComputingProvidedBy")}</span> : null}
        </a>
      </div>
    </footer>
  );
}
