"use client";

import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";

import { InfraCalculator } from "@/components/pages/InfraCalculator";
import { useWorkbench } from "@/workbench-context";

import styles from "./RainyunBanner.module.css";

const BANNER_DISMISSED_KEY = "riic:rainyun-banner-dismissed-day";
const BANNER_CHANGED_EVENT = "riic:rainyun-banner-changed";
let dismissedDay = "";

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function isBannerVisible() {
  const today = localDay();
  if (dismissedDay === today) return false;
  try {
    return window.localStorage.getItem(BANNER_DISMISSED_KEY) !== today;
  } catch {
    return true;
  }
}

function subscribeBanner(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  function refresh() {
    onChange();
    clearTimeout(timer);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    timer = setTimeout(refresh, midnight.getTime() - Date.now());
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
  dismissedDay = localDay();
  try {
    window.localStorage.setItem(BANNER_DISMISSED_KEY, dismissedDay);
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
              <span className={styles.sponsor}>{t("homeBannerTitle")}</span>
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
