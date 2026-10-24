import { StatusRouteSkeleton } from "@/components/workbench/WorkbenchRouteSkeleton";
import { SkeletonRouteFallback } from "@/components/ui/skeleton-swap";

export default function Loading() {
  return <SkeletonRouteFallback><StatusRouteSkeleton /></SkeletonRouteFallback>;
}
