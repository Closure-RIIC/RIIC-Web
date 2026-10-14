"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { useLocale } from "use-intl";
import { tutorialVideoUrl } from "@/tutorial-videos";

export function MaaBoxVideo() {
  const locale = useLocale();
  const en = locale === "en";
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = en ? "How to get box.json with MAA" : "如何用 MAA 获取 box.json";
  const src = tutorialVideoUrl("maa-box.mp4");

  return (
    <div className="overflow-hidden rounded-[4px] border border-border bg-black" data-maa-box-video>
      {started ? (
        <video
          className="aspect-video w-full"
          src={src}
          poster="/images/help/maa-box-cover.webp"
          aria-label={title}
          controls
          controlsList="nodownload"
          playsInline
          autoPlay
          preload="none"
          onError={() => setFailed(true)}
        >
          {en ? "Your browser does not support video playback." : "你的浏览器不支持视频播放。"}
        </video>
      ) : (
        <button
          type="button"
          className="group relative block aspect-video w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22BBFF]"
          aria-label={en ? `Play video: ${title}` : `播放视频：${title}`}
          onClick={() => setStarted(true)}
        >
          <img
            src="/images/help/maa-box-cover.webp"
            alt={en ? "MAA — export your Operator Box" : "明日方舟 MAA 一键获取 BOX，干员识别与 BOX 整理"}
            width={1672}
            height={941}
            className="h-full w-full object-contain"
          />
          <span className="absolute bottom-3 left-3 inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-black/85 px-4 text-sm font-medium text-white transition-colors group-hover:bg-[#007BAA] sm:bottom-4 sm:left-4">
            <Play className="size-4 fill-current" aria-hidden="true" />
            {en ? "Watch tutorial" : "播放教程"}
            <span className="font-number text-white/75">00:44</span>
          </span>
        </button>
      )}
      {failed && <p role="alert" className="p-4 text-sm text-white">{en ? "Video could not load. Refresh the page and try again." : "视频加载失败，请刷新页面后重试。"}</p>}
    </div>
  );
}
