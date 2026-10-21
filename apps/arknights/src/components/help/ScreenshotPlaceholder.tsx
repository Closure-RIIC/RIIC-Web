"use client";
import { useTranslations } from "use-intl";


type ScreenshotPlaceholderProps = {
  slot: string;
  title: string;
  description: string;
  fileName: string;
  src?: string;
  alt?: string;
  imageWidth?: number;
  imageHeight?: number;
  highlights?: ScreenshotHighlight[];
};

export type ScreenshotHighlight = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export function ScreenshotPlaceholder({
  slot,
  title,
  description,
  fileName,
  src,
  alt,
  imageWidth,
  imageHeight,
  highlights = [],
}: ScreenshotPlaceholderProps) {
  const intl = useTranslations();

  if (src && alt) {
    const maskId = `help-screenshot-mask-${slot.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const aspectRatio = imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : undefined;

    return (
      <figure
        className="overflow-hidden rounded-[4px] border border-border bg-muted/20"
        data-help-screenshot-slot={slot}
      >
        <a
          aria-label={intl("components_help_ScreenshotPlaceholder.openFullResolutionImage", { title: title })}
          className="group relative block overflow-hidden bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          href={src}
          rel="noreferrer"
          style={{ aspectRatio }}
          target="_blank"
        >
          <span
            className="absolute inset-0 block transition-transform duration-200 group-hover:scale-[1.01] motion-reduce:transform-none motion-reduce:transition-none"
            data-help-screenshot-zoom-layer
          >
            <img
              src={src}
              alt={alt}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              sizes="(min-width: 1280px) 68rem, (min-width: 640px) calc(100vw - 8rem), calc(100vw - 3rem)"
              className="object-contain"
            />
            {highlights.length > 0 ? (
              <>
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 size-full"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  <defs>
                    <mask id={maskId} maskUnits="userSpaceOnUse">
                      <rect fill="white" height="100" width="100" />
                      {highlights.map((highlight, index) => (
                        <rect
                          fill="black"
                          height={highlight.height}
                          key={`${highlight.label}-${index}`}
                          rx="0.4"
                          width={highlight.width}
                          x={highlight.x}
                          y={highlight.y}
                        />
                      ))}
                    </mask>
                  </defs>
                  <rect fill="rgba(0, 0, 0, 0.32)" height="100" mask={`url(#${maskId})`} width="100" />
                </svg>
                {highlights.map((highlight, index) => (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute rounded-[2px] border-2 border-amber-300 bg-amber-200/10 shadow-[0_0_0_2px_rgba(0,0,0,0.65),0_0_22px_rgba(251,191,36,0.9)] sm:border-[3px]"
                    data-help-screenshot-highlight={index + 1}
                    data-help-screenshot-highlight-label={highlight.label}
                    data-help-screenshot-highlight-x={highlight.x}
                    data-help-screenshot-highlight-y={highlight.y}
                    key={`${highlight.label}-${index}`}
                    style={{
                      height: `${highlight.height}%`,
                      left: `${highlight.x}%`,
                      top: `${highlight.y}%`,
                      width: `${highlight.width}%`,
                    }}
                  >
                    <span className="absolute -left-2 -top-2 grid size-6 place-items-center border-2 border-black/70 bg-amber-300 text-[11px] font-bold text-black">
                      {index + 1}
                    </span>
                  </span>
                ))}
              </>
            ) : null}
          </span>
          <span className="absolute bottom-2 right-2 z-10 inline-flex min-h-9 items-center bg-black/80 px-3 text-xs font-semibold text-white">
            {intl("components_help_ScreenshotPlaceholder.fullSize")}
          </span>
        </a>
        <figcaption className="flex flex-wrap items-center gap-2 border-t border-border/80 bg-background/95 px-4 py-3 text-xs leading-5 text-muted-foreground">
          <span>{intl("components_help_ScreenshotPlaceholder.screenshot", { title: title })}</span>
          {highlights.map((highlight, index) => (
            <span className="inline-flex items-center gap-1 rounded-[2px] bg-amber-100 px-2 py-0.5 font-medium text-amber-950" key={`${highlight.label}-${index}`}>
              <span className="font-number font-bold">{index + 1}</span>
              {highlight.label}
            </span>
          ))}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure
      className="overflow-hidden rounded-[4px] border border-dashed border-border bg-muted/25"
      data-help-screenshot-slot={slot}
      aria-label={intl("components_help_ScreenshotPlaceholder.screenshotPlaceholder", { title: title })}
    >
      <div className="grid aspect-video place-items-center p-5 text-center sm:p-7">
        <div className="max-w-lg">
          <p className="text-xs font-semibold text-primary">{intl("components_help_ScreenshotPlaceholder.screenshot2", { slot: slot })}</p>
          <p className="mt-1 font-semibold text-foreground">{title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <figcaption className="border-t border-dashed border-border bg-background px-4 py-3 text-xs leading-5 text-muted-foreground">
        {intl("components_help_ScreenshotPlaceholder.replaceLaterWith")}<code className="break-all rounded bg-muted px-1.5 py-0.5 text-foreground">{fileName}</code>
      </figcaption>
    </figure>
  );
}
