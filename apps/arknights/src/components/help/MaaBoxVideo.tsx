"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_help_MaaBoxVideo.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_help_MaaBoxVideo");


import { Play } from "lucide-react";
import { useState } from "react";
import { useLocale } from "use-intl";
import { tutorialVideoUrl } from "@/tutorial-videos";

export function MaaBoxVideo() {
  const locale = useLocale();
  const en = locale;
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = uiText.text(en, "howToGetBoxJsonWithMaa");
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
          {uiText.text(en, "yourBrowserDoesNotSupportVideoPlayback")}
        </video>
      ) : (
        <button
          type="button"
          className="group relative block aspect-video w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22BBFF]"
          aria-label={uiText.text(en, "playVideo", { value1: title })}
          onClick={() => setStarted(true)}
        >
          <img
            src="/images/help/maa-box-cover.webp"
            alt={uiText.text(en, "maaExportYourOperatorBox")}
            width={1672}
            height={941}
            className="h-full w-full object-contain"
          />
          <span className="absolute bottom-3 left-3 inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-black/85 px-4 text-sm font-medium text-white transition-colors group-hover:bg-[#007BAA] sm:bottom-4 sm:left-4">
            <Play className="size-4 fill-current" aria-hidden="true" />
            {uiText.text(en, "watchTutorial")}
            <span className="font-number text-white/75">00:44</span>
          </span>
        </button>
      )}
      {failed && <p role="alert" className="p-4 text-sm text-white">{uiText.text(en, "videoCouldNotLoadRefreshThePageAnd")}</p>}
    </div>
  );
}
