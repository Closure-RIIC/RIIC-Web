import { useEffect, useState } from "react";
import { gameHref } from "@riic/shell/games";
import { FilingLinks } from "@riic/shell/FilingLinks";
import { useWorkspace } from "../state";

export function SiteFooter() {
  const { locale, colorMode, t } = useWorkspace();
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(location.origin), []);
  const main = gameHref("arknights", origin, import.meta.env.VITE_ARKNIGHTS_ORIGIN);

  return (
    <footer className="ef-site-footer workbench-footer">
      <nav className="ef-footer-links" aria-label={t("网站信息", "Site information")}>
        <a href={`${main}terms`}>{t("本站服务条款", "Terms of Service")}</a>
        <a href={`${main}privacy`}>{t("本站隐私政策", "Privacy Policy")}</a>
        <a href={`${main}about`} data-about-link>{t("关于我们", "About us")}</a>
        <a href={`${main}wishes`} data-wishes-link>{t("许愿", "Wishes")}</a>
      </nav>
      <div className="ef-footer-details">
        <FilingLinks />
        <span className="ef-footer-divider" aria-hidden="true" />
        <a
          href="https://www.rainyun.com/riic_"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("由雨云提供云计算服务（在新标签页打开）", "Cloud services provided by Rainyun (opens in a new tab)")}
          className="ef-footer-sponsor"
          data-rainyun-link
        >
          <span data-rainyun-copy>{t("由", "Powered by")}</span>
          <img
            src={colorMode === "dark" ? "/images/partners/rainyun-logo-white.png" : "/images/partners/rainyun-logo.png"}
            alt=""
            width={colorMode === "dark" ? 1717 : 1120}
            height={colorMode === "dark" ? 554 : 390}
            decoding="async"
          />
          {locale === "zh" ? <span>提供云计算服务</span> : null}
        </a>
      </div>
    </footer>
  );
}
