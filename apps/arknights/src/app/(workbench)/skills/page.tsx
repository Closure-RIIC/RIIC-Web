import { Suspense } from "react";
import { lazyWithMessages } from "@/i18n/features-client";
import Loading from "./loading";

const SkillQuery = lazyWithMessages(
  () => import("@/components/pages/SkillQuery").then(module => ({ default: module.SkillQuery })),
  "apps/arknights/src/components/pages/SkillQuery.tsx",
);

export default function Page() {
  return <Suspense fallback={<Loading />}><SkillQuery /></Suspense>;
}
