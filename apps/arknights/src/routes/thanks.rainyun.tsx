import { ArrowUpRight, Bot, Gamepad2, Server } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { InfoPageLayout } from "@/components/layout/InfoPageLayout";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { withMessages } from "@/i18n/features-client";
import { pageHead } from "@/i18n/metadata";

import styles from "./RainyunThanks.module.css";

function RainyunThanksPage() {
  const t = useTranslations("RainyunThanks");
  const services = [
    { icon: Server, title: t("cloudTitle"), description: t("cloudIntro"), action: t("readDocs"), href: "https://www.rainyun.com/docs/products/rcs/overview" },
    { icon: Gamepad2, title: t("gameTitle"), description: t("gameIntro"), action: t("readDocs"), href: "https://www.rainyun.com/docs/products/rgs/overview" },
    { icon: Bot, title: t("botTitle"), description: t("botIntro"), action: t("viewCloudServer"), href: "https://www.rainyun.com/rcs" },
  ];

  return (
    <InfoPageLayout title={t("title")} href="/thanks/rainyun" contentId="rainyun-content">
      <div className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.brand}>
            <img src="/images/partners/rainyun-logo.png" alt="" width={1120} height={390} className={styles.logo} />
          </div>
          <div className={styles.intro}>
            <h1>{t("title")}</h1>
            <p>{t("description")}</p>
            <a href="https://www.rainyun.com/home" target="_blank" rel="noopener noreferrer" className={styles.primaryLink}>
              {t("visit")}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
            </a>
          </div>
          <span className={styles.hazard} aria-hidden="true" />
        </header>
        <section aria-labelledby="rainyun-services-title" className={styles.section}>
          <h2 id="rainyun-services-title" className={styles.sectionTitle}>{t("servicesTitle")}</h2>
          <div className={styles.services}>
            {services.map(({ icon: Icon, title, description, action, href }) => (
              <article key={href} className={styles.service}>
                <div className={styles.serviceTitle}>
                  <Icon className={styles.icon} aria-hidden="true" />
                  <h3>{title}</h3>
                </div>
                <p>{description}</p>
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${title} · ${action}`} className={styles.serviceLink}>
                  {action}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
        </section>
        <section aria-labelledby="rainyun-panel-title" className={styles.section}>
          <h2 id="rainyun-panel-title" className={styles.sectionTitle}>{t("panelTitle")}</h2>
          <div className={styles.gallery}>
            <figure className={styles.figure}>
              <figcaption>
                <h3>{t("rgpPanel")}</h3>
                <p>{t("rgpDescription")}</p>
              </figcaption>
              <div className={styles.screen}>
                <img src="/images/partners/rainyun-rgp-panel.webp" alt={t("rgpPanel")} width={964} height={223} loading="lazy" decoding="async" />
              </div>
            </figure>
            <figure className={styles.figure}>
              <figcaption>
                <h3>{t("gameCatalog")}</h3>
                <p>{t("catalogDescription")}</p>
              </figcaption>
              <div className={styles.screen}>
                <img src="/images/partners/rainyun-game-catalog.webp" alt={t("gameCatalog")} width={2193} height={807} loading="lazy" decoding="async" />
              </div>
            </figure>
          </div>
        </section>
      </div>
    </InfoPageLayout>
  );
}

const TranslatedRouteComponent = withMessages(withPageScrollbars(RainyunThanksPage), "apps/arknights/src/routes/thanks.rainyun.tsx");

export const Route = createFileRoute("/thanks/rainyun")({
  head: ({ matches }) => pageHead(matches, "rainyunThanks"),
  component: TranslatedRouteComponent,
});
