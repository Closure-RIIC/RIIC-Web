"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_app_wishes2_page.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_app_wishes2_page");


import { Link } from "@tanstack/react-router";
import { useRouter } from "@/navigation";
import { useState } from "react";


export default function Wishes2Page() {
  const rawLocale = useRawLocale();
  const router = useRouter();
  const [openingRoute, setOpeningRoute] = useState<"/wishes" | null>(null);

  const openRoute = (route: "/wishes") => {
    if (openingRoute) return;

    router.prefetch(route);
    setOpeningRoute(route);
  };

  return (
    <main
      aria-label={rawText.text(rawLocale, "wishWallBackground")}
      aria-busy={Boolean(openingRoute)}
      className="relative min-h-screen w-full overflow-hidden bg-[#1c373a] bg-[url('/images/wishes/wish-background.png')] bg-cover bg-center bg-no-repeat"
    >
      {openingRoute ? (
        <div className="wishes2-wave-scene" aria-hidden="true">
          <span className="wishes2-wave wishes2-wave-back" />
          <span
            className="wishes2-wave wishes2-wave-front"
            onAnimationEnd={() => router.push(openingRoute)}
          />
        </div>
      ) : null}
      <nav
        aria-label={rawText.text(rawLocale, "pageNavigation")}
        className="absolute left-0 top-5 z-10 size-[90px]"
      >
        <Link
          to="/"
          aria-label={rawText.text(rawLocale, "backToMainPage")}
          title={rawText.text(rawLocale, "backToMainPage")}
          className="block size-[90px] transition-[filter] duration-150 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <img
            src="/images/wishes/act53-back.png"
            alt=""
            width={90}
            height={90}
            className="block size-[90px]"
          />
        </Link>
      </nav>
      <nav
        aria-label={rawText.text(rawLocale, "eventFeatures")}
        className="absolute right-8 top-6 z-10 flex items-center gap-5"
      >
        <button
          type="button"
          aria-label={rawText.text(rawLocale, "operatorTrust")}
          title={rawText.text(rawLocale, "operatorTrust")}
          className="size-11 transition-[filter] duration-150 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <img
            src="/images/wishes/icon-operator.png"
            alt=""
            width={44}
            height={44}
            className="block size-11"
          />
        </button>
        <button
          type="button"
          aria-label={rawText.text(rawLocale, "videoRecords")}
          title={rawText.text(rawLocale, "videoRecords")}
          className="size-11 transition-[filter] duration-150 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <img
            src="/images/wishes/icon-film.png"
            alt=""
            width={44}
            height={44}
            className="block size-11"
          />
        </button>
        <button
          type="button"
          aria-label={rawText.text(rawLocale, "storyRecollections")}
          title={rawText.text(rawLocale, "storyRecollections")}
          className="size-11 transition-[filter] duration-150 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <img
            src="/images/wishes/icon-pic.png"
            alt=""
            width={44}
            height={44}
            className="block size-11"
          />
        </button>
      </nav>
      <div
        aria-label={rawText.text(rawLocale, "eventEntry")}
        className="absolute bottom-6 left-8 z-10 flex flex-col items-start gap-5"
      >
        <Link
          to="/wishes"
          aria-label={rawText.text(rawLocale, "openWishWall")}
          onClick={(event) => {
            event.preventDefault();
            openRoute("/wishes");
          }}
          className="relative block h-[96px] w-[339px] outline-none transition-[filter] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          <img
            src="/images/wishes/traveler-backpack.png"
            alt="Traveler's Backpack"
            width={339}
            height={96}
            className="block h-[96px] w-[339px]"
          />
          <span className="absolute left-[86px] top-[68px] whitespace-nowrap text-[18px] font-medium leading-none text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]">{rawText.text(rawLocale, "travelerSBackpack")}</span>
        </Link>
        <button
          type="button"
          aria-label={rawText.text(rawLocale, "openWishWall")}
          disabled={Boolean(openingRoute)}
          onClick={() => openRoute("/wishes")}
          className="relative h-[84px] w-[203px] cursor-pointer text-left outline-none transition-[filter] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-default"
        >
          <img
            src="/images/wishes/wishlist.png"
            alt="Wishlist"
            width={203}
            height={84}
            className="block h-[84px] w-[203px]"
          />
          <span className="absolute left-[86px] top-[62px] whitespace-nowrap text-[18px] font-medium leading-none text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]">{rawText.text(rawLocale, "wishlist")}</span>
        </button>
      </div>
    </main>
  );
}
