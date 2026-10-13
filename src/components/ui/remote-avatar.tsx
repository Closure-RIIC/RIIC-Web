"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { SkeletonSwap } from "@/components/ui/skeleton-swap";

export function RemoteAvatar({
  src,
  alt,
  pixelSize,
  className,
  imageClassName,
  emptyFallback,
  loadingFallback,
  loading,
}: {
  src?: string | null;
  alt: string;
  pixelSize: number;
  className?: string;
  imageClassName?: string;
  emptyFallback: ReactNode;
  loadingFallback?: ReactNode;
  loading?: "eager" | "lazy";
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = Boolean(src && loadedSrc === src);
  const failed = Boolean(src && failedSrc === src);

  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden", className)}
      aria-busy={src && !loaded && !failed ? "true" : undefined}
      data-remote-avatar-state={!src || failed ? "fallback" : loaded ? "loaded" : "loading"}
    >
      {!src || failed ? emptyFallback : <SkeletonSwap ready={loaded} skeleton={loadingFallback ?? emptyFallback} className="size-full">
        <img
          src={src}
          alt={alt}
          width={pixelSize}
          height={pixelSize}
          decoding="async"
          loading={loading}
          fetchPriority={loading === "lazy" ? "auto" : "high"}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn("absolute inset-0 size-full object-cover", imageClassName)}
        />
      </SkeletonSwap>}
    </span>
  );
}
