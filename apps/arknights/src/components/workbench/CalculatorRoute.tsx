"use client";

import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";

import { InfraCalculator } from "@/components/pages/InfraCalculator";
import { useWorkbench } from "@/workbench-context";

import styles from "./RainyunBanner.module.css";

const BANNER_DISMISSED_KEY = "riic:rainyun-banner-hidden-until";
const BANNER_CHANGED_EVENT = "riic:rainyun-banner-changed";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let hiddenUntil = 0;

function bannerHiddenUntil() {
  try {
    const saved = Number(window.localStorage.getItem(BANNER_DISMISSED_KEY));
    return Math.max(hiddenUntil, Number.isFinite(saved) ? saved : 0);
  } catch {
    return hiddenUntil;
  }
}

function isBannerVisible() {
  return bannerHiddenUntil() <= Date.now();
}

function subscribeBanner(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  function refresh() {
    onChange();
    clearTimeout(timer);
    const remaining = bannerHiddenUntil() - Date.now();
    if (remaining > 0) timer = setTimeout(refresh, Math.min(remaining, ONE_WEEK_MS));
  }
  window.addEventListener("storage", refresh);
  window.addEventListener("focus", refresh);
  window.addEventListener(BANNER_CHANGED_EVENT, refresh);
  refresh();
  return () => {
    clearTimeout(timer);
    window.removeEventListener("storage", refresh);
    window.removeEventListener("focus", refresh);
    window.removeEventListener(BANNER_CHANGED_EVENT, refresh);
  };
}

function dismissBanner() {
  hiddenUntil = Date.now() + ONE_WEEK_MS;
  try {
    window.localStorage.setItem(BANNER_DISMISSED_KEY, String(hiddenUntil));
  } catch { /* Still dismiss in this tab when storage is unavailable. */ }
  window.dispatchEvent(new Event(BANNER_CHANGED_EVENT));
}

export function CalculatorRoute() {
  const { calculator } = useWorkbench();
  const t = useTranslations("RainyunThanks");
  const bannerVisible = useSyncExternalStore(subscribeBanner, isBannerVisible, () => false);

  return (
    <>
      {bannerVisible ? (
        <div className={styles.banner}>
          <span className={styles.hazard} aria-hidden="true" />
          <a href="https://www.rainyun.com/home" target="_blank" rel="noopener noreferrer" data-rainyun-home-banner
            className={styles.link}>
            <span className={styles.brand}>
              <img src="/images/partners/rainyun-logo.png" alt="" width={1120} height={390} className={styles.logo} />
            </span>
            <span className={styles.message}>
              <span className={styles.headline}>{t("homeBannerDescription")}</span>
              <span className={styles.games}>
                <span className={styles.gameLabel}>{t("homeBannerMultiplayer")}</span>
                <span className={styles.game}>Minecraft</span>
                <span className={styles.game}>{t("homeBannerSevenDays")}</span>
                <span className={styles.game}>Rust</span>
              </span>
            </span>
            <span className={styles.offer}>
              <span className={styles.offerHeading}><span className={styles.offerLabel}>{t("homeBannerOfferLabel")}</span><span className={styles.offerValue}>{t("homeBannerOfferValue")}</span></span>
              <span className={styles.terms}>{t("homeBannerOfferTerms")}</span>
            </span>
          </a>
          <button type="button" onClick={dismissBanner} aria-label={t("closeBanner")}
            className={styles.close}>
            <X className="size-6" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <InfraCalculator {...calculator} />
    </>
  );
}
