"use client";

import { Play } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocale } from "use-intl";

export function TutorialVideo({ src, title, cover, duration }: {
  src: string;
  title: string;
  cover: ReactNode;
  duration: string;
}) {
  const locale = useLocale();
  const en = locale === "en";
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="overflow-hidden rounded-[4px] border border-border bg-black" data-tutorial-video>
      {started ? (
        <video src={src} aria-label={title} className="aspect-video w-full" controls controlsList="nodownload" playsInline autoPlay preload="none" onError={() => setFailed(true)}>
          {en ? "Your browser does not support video playback." : "你的浏览器不支持视频播放。"}
        </video>
      ) : (
        <button type="button" aria-label={en ? `Play video: ${title}` : `播放视频：${title}`} className="group relative block aspect-video w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22BBFF]" onClick={() => setStarted(true)}>
          {cover}
          <span className="absolute bottom-3 left-3 inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-black/85 px-4 text-sm font-medium text-white transition-colors group-hover:bg-[#007BAA]">
            <Play className="size-4 fill-current" aria-hidden="true" />{en ? "Watch tutorial" : "播放教程"}<span className="font-number text-white/75">{duration}</span>
          </span>
        </button>
      )}
      {failed && <p role="alert" className="p-4 text-sm text-white">{en ? "Video could not load. Try another browser or watch the original on Bilibili below." : "视频无法播放，请尝试其他浏览器，或通过下方链接观看 B站原视频。"}</p>}
    </div>
  );
}

