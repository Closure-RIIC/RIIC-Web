"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const dynamic = "force-static";

export default function Wishes2Page() {
  const router = useRouter();
  const [openingRoute, setOpeningRoute] = useState<"/wishes" | null>(null);

  const openRoute = (route: "/wishes") => {
    if (openingRoute) return;

    router.prefetch(route);
    setOpeningRoute(route);
  };

  return (
    <main
      aria-label="许愿墙背景"
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
        aria-label="页面导航"
        className="absolute left-0 top-5 z-10 size-[90px]"
      >
        <Link
          href="/"
          aria-label="返回主界面"
          title="返回主界面"
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
        aria-label="活动功能"
        className="absolute right-8 top-6 z-10 flex items-center gap-5"
      >
        <button
          type="button"
          aria-label="干员信赖"
          title="干员信赖"
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
          aria-label="影像资料"
          title="影像资料"
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
          aria-label="本篇回想"
          title="本篇回想"
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
        aria-label="活动入口"
        className="absolute bottom-6 left-8 z-10 flex flex-col items-start gap-5"
      >
        <Link
          href="/wishes"
          aria-label="进入许愿墙"
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
          <span className="absolute left-[86px] top-[68px] whitespace-nowrap text-[18px] font-medium leading-none text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]">
            旅行者的背包
          </span>
        </Link>
        <button
          type="button"
          aria-label="进入许愿墙"
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
          <span className="absolute left-[86px] top-[62px] whitespace-nowrap text-[18px] font-medium leading-none text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]">
            愿望清单
          </span>
        </button>
      </div>
    </main>
  );
}
