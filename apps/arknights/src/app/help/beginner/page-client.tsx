"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../../messages/zh-CN/AK_app_help_beginner_page_client.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_app_help_beginner_page_client");


import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { TutorialVideo } from "@/components/help/TutorialVideo";
import { MaaBoxVideo } from "@/components/help/MaaBoxVideo";
import { useLocale } from "use-intl";
import { tutorialVideoUrl } from "@/tutorial-videos";

const bilibiliTutorials = [
  {
    src: tutorialVideoUrl("export-maa.mp4"),
    duration: "00:44",
    title: "tutorial_1_title" as const,
    category: "tutorial_2_category" as const,
    cover: "tutorial_3_cover" as const,
    description: "tutorial_4_description" as const,
  },
  {
    bvid: "BV1hi4y1e7eD",
    src: tutorialVideoUrl("manual-schedule-audio.mp4"),
    duration: "04:56",
    title: "tutorial_5_title" as const,
    category: "tutorial_6_category" as const,
    cover: "tutorial_7_cover" as const,
    description: "tutorial_8_description" as const,
  },

  {
    bvid: "BV1HwuH69ENX",
    src: tutorialVideoUrl("shifts-orundum-audio.mp4"),
    duration: "05:10",
    title: "tutorial_9_title" as const,
    category: "tutorial_10_category" as const,
    cover: "tutorial_11_cover" as const,
    description: "tutorial_12_description" as const,
  },
];

export default function BeginnerTutorialPage({ embedded = false }: { embedded?: boolean }) {
  const locale = useLocale();
  const en = locale;

  return (
    <article className="flex w-full flex-col gap-6 pt-5">
      {!embedded ? <header className="border-b border-border pb-5">
        <Link to="/docs" className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3.5" aria-hidden="true" />{uiText.text(en, "backToHelp")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{uiText.text(en, "beginnerTutorials")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{uiText.text(en, "prepareYourOperatorBoxFollowAScheduleAnd")}</p>
      </header> : null}

      <section className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3" aria-label={uiText.text(en, "videoTutorials")}>
        <article id="maa-box-video" className="min-w-0 scroll-mt-5" aria-labelledby="maa-box-video-title">
          <MaaBoxVideo />
          <div className="pt-4">
            <span className="text-xs text-muted-foreground">{uiText.text(en, "operatorBoxOnSiteVideo0044")}</span>
            <h2 id="maa-box-video-title" className="mt-2 text-lg font-semibold">{uiText.text(en, "howToGetBoxJsonWithMaa")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{uiText.text(en, "exportYourOperatorBoxThenUploadOrPaste")}</p>
            <Link to="/docs/$slug" params={{ slug: "first-import" }} search={{ source: "maa" }} hash="import-methods" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {uiText.text(en, "viewImportSteps")}<ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </article>

        {bilibiliTutorials.map((tutorial, index) => (
          <article key={tutorial.src} className="min-w-0">
            <TutorialVideo
              src={tutorial.src}
              title={uiText.text(en, tutorial.title)}
              duration={tutorial.duration}
              cover={
                <span className="relative flex aspect-video flex-col overflow-hidden bg-[#171C20] p-5 text-white transition-colors group-hover:bg-[#202A30]">
                  <span className="absolute inset-x-0 top-0 h-1 bg-[#22BBFF]" aria-hidden="true" />
                  <span className="flex items-center justify-between gap-2 text-xs text-white/70">
                    <span>{uiText.text(en, tutorial.category)}</span><span>{uiText.text(en, "tutorial")}</span>
                  </span>
                  <span className="flex flex-1 items-center gap-4 pb-8">
                    <span className="font-number text-4xl text-[#22BBFF]" aria-hidden="true">{String(index + 2).padStart(2, "0")}</span>
                    <span className="text-2xl font-semibold leading-tight">{uiText.text(en, tutorial.cover)}</span>
                  </span>
                </span>
              }
            />
            <div className="pt-4">
              <span className="text-xs text-muted-foreground">{uiText.text(en, "onSiteVideo")} · {tutorial.duration}</span>
              <h2 className="mt-2 text-lg font-semibold">{uiText.text(en, tutorial.title)}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{uiText.text(en, tutorial.description)}</p>
              {tutorial.bvid ? <a href={`https://www.bilibili.com/video/${tutorial.bvid}/`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" data-bilibili-tutorial={tutorial.bvid}>
                {uiText.text(en, "originalVideoOnBilibili")}<ExternalLink className="size-4" aria-hidden="true" />
              </a> : null}
            </div>
          </article>
        ))}
      </section>
    </article>
  );
}
