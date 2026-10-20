"use client";

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
    title: "将排班导出到 MAA",
    titleEn: "Export a schedule to MAA",
    category: "MAA 使用",
    categoryEn: "MAA WORKFLOW",
    cover: "导出到 MAA",
    coverEn: "Export to MAA",
    description: "演示如何将排班导出到 MAA 使用。",
    descriptionEn: "See how to export a schedule to MAA.",
  },
  {
    bvid: "BV1hi4y1e7eD",
    src: tutorialVideoUrl("manual-schedule-audio.mp4"),
    duration: "04:56",
    title: "手动抄作业教程",
    titleEn: "Follow a schedule manually",
    category: "手动排班",
    categoryEn: "MANUAL SCHEDULING",
    cover: "手动抄作业",
    coverEn: "Follow a schedule",
    description: "跟着教程学习手动抄作业。",
    descriptionEn: "Follow the tutorial to apply a schedule manually.",
  },

  {
    bvid: "BV1HwuH69ENX",
    src: tutorialVideoUrl("shifts-orundum-audio.mp4"),
    duration: "05:10",
    title: "手把手教学换班和搓玉",
    titleEn: "Shift changes and Orundum production",
    category: "换班与搓玉",
    categoryEn: "SHIFTS & ORUNDUM",
    cover: "换班与搓玉",
    coverEn: "Shifts & Orundum",
    description: "跟着实机演示学习搓玉和换班操作。",
    descriptionEn: "Follow the in-game demonstration to learn Orundum production and shift changes.",
  },
];

export default function BeginnerTutorialPage({ embedded = false }: { embedded?: boolean }) {
  const locale = useLocale();
  const en = locale === "en";

  return (
    <article className="flex w-full flex-col gap-6 pt-5">
      {!embedded ? <header className="border-b border-border pb-5">
        <Link to="/docs" className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3.5" aria-hidden="true" />{en ? "Back to Help" : "返回帮助首页"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{en ? "Beginner tutorials" : "新手教程"}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{en ? "Prepare your Operator Box, follow a schedule, and learn shift changes and Orundum production. Pick a tutorial to get started." : "准备干员 Box、手动抄作业、换班与搓玉，选一个教程开始。"}</p>
      </header> : null}

      <section className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3" aria-label={en ? "Video tutorials" : "视频教程列表"}>
        <article id="maa-box-video" className="min-w-0 scroll-mt-5" aria-labelledby="maa-box-video-title">
          <MaaBoxVideo />
          <div className="pt-4">
            <span className="text-xs text-muted-foreground">{en ? "OPERATOR BOX · ON-SITE VIDEO · 00:44" : "干员数据 · 站内播放 · 00:44"}</span>
            <h2 id="maa-box-video-title" className="mt-2 text-lg font-semibold">{en ? "How to get box.json with MAA" : "如何用 MAA 获取 box.json"}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{en ? "Export your Operator Box, then upload or paste it into the calculator." : "用 MAA 导出干员 Box，再上传文件或粘贴到计算器。"}</p>
            <Link to="/docs/$slug" params={{ slug: "first-import" }} search={{ source: "maa" }} hash="import-methods" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {en ? "View import steps" : "查看导入步骤"}<ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </article>

        {bilibiliTutorials.map((tutorial, index) => (
          <article key={tutorial.src} className="min-w-0">
            <TutorialVideo
              src={tutorial.src}
              title={en ? tutorial.titleEn : tutorial.title}
              duration={tutorial.duration}
              cover={
                <span className="relative flex aspect-video flex-col overflow-hidden bg-[#171C20] p-5 text-white transition-colors group-hover:bg-[#202A30]">
                  <span className="absolute inset-x-0 top-0 h-1 bg-[#22BBFF]" aria-hidden="true" />
                  <span className="flex items-center justify-between gap-2 text-xs text-white/70">
                    <span>{en ? tutorial.categoryEn : tutorial.category}</span><span>{en ? "TUTORIAL" : "视频教程"}</span>
                  </span>
                  <span className="flex flex-1 items-center gap-4 pb-8">
                    <span className="font-number text-4xl text-[#22BBFF]" aria-hidden="true">{String(index + 2).padStart(2, "0")}</span>
                    <span className="text-2xl font-semibold leading-tight">{en ? tutorial.coverEn : tutorial.cover}</span>
                  </span>
                </span>
              }
            />
            <div className="pt-4">
              <span className="text-xs text-muted-foreground">{en ? "ON-SITE VIDEO" : "站内播放"} · {tutorial.duration}</span>
              <h2 className="mt-2 text-lg font-semibold">{en ? tutorial.titleEn : tutorial.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{en ? tutorial.descriptionEn : tutorial.description}</p>
              {tutorial.bvid ? <a href={`https://www.bilibili.com/video/${tutorial.bvid}/`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" data-bilibili-tutorial={tutorial.bvid}>
                {en ? "Original video on Bilibili" : "B站原视频"}<ExternalLink className="size-4" aria-hidden="true" />
              </a> : null}
            </div>
          </article>
        ))}
      </section>
    </article>
  );
}
