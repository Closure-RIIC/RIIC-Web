import { useTranslations } from "use-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRouteFallback } from "@/components/ui/skeleton-swap";

export default function Loading() {
  const t = useTranslations("components_workbench_WorkbenchRouteSkeleton");
  return <SkeletonRouteFallback><div role="status" aria-label={t("loadingTrainingCalculator")} className="grid gap-5 pt-5"><Skeleton className="h-7 w-32" /><Skeleton className="h-80 w-full" /><Skeleton className="h-40 w-full" /></div></SkeletonRouteFallback>;
}
