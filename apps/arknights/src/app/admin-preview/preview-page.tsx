"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { AdminPageHeader, adminPageClass } from "../admin/admin-page";
import { AdminUserManagement } from "../admin/users/users-client";
import { AdminSolverMetrics } from "../admin/users/solver-metrics-client";
import { DiagnosticsPanel } from "../admin/diagnostics-panel";
import { SolverVersion } from "../admin/solver-version";
import { usePreviewAdmin } from "./preview-client";
import { Skeleton } from "@/components/ui/skeleton";

const Loading = () => <div className={adminPageClass}><Skeleton className="h-64 w-full" /></div>;
const Issues = lazyWithMessages(() => import("../admin/issues/issues-client").then(module => ({ default: module.AdminIssues })), "apps/arknights/src/app/admin/issues/issues-client.tsx");
const Quality = lazyWithMessages(() => import("../admin/quality/quality-client").then(module => ({ default: module.QualityWorkbench })), "apps/arknights/src/app/admin/quality/quality-client.tsx");
const Skills = lazyWithMessages(() => import("../admin/skills/skill-annotations-client").then(module => ({ default: module.SkillAnnotationManager })), "apps/arknights/src/app/admin/skills/skill-annotations-client.tsx");
const Changelog = lazyWithMessages(() => import("../admin/changelog/changelog-manager").then(module => ({ default: module.ChangelogManager })), "apps/arknights/src/app/admin/changelog/changelog-manager.tsx");

export function PreviewPage({ section }: { section: string }) {
  return <Suspense fallback={<Loading />}><PreviewContent section={section} /></Suspense>;
}
function PreviewContent({ section }: { section: string }) {
  const isAdmin = usePreviewAdmin();
  const t = useTranslations("AdminWorkspace");
  if (!isAdmin && ["users", "skills", "changelog"].includes(section)) return <main id="admin-content" className={adminPageClass}><p>{t("accessDenied")}</p><Link to="/admin-preview" className="underline">{t("backOverview")}</Link></main>;
  if (section === "users") return <main id="admin-content" className={adminPageClass}><AdminPageHeader title="users" description="usersHint" /><AdminUserManagement /></main>;
  if (section === "issues") return <Issues isAdmin={isAdmin} />;
  if (section === "quality") return <><p className="px-4 pt-4 text-xs text-muted-foreground sm:px-6 lg:px-8">{t("previewReadOnly")}</p><Quality /></>;
  if (section === "skills") return <Skills />;
  if (section === "changelog") return <><p className="px-4 pt-4 text-xs text-muted-foreground sm:px-6 lg:px-8">{t("previewReadOnly")}</p><Changelog /></>;
  return <main id="admin-content" className={adminPageClass}>
    <AdminPageHeader title="overview" description="overviewHint" />
    <AdminSolverMetrics />
    <SolverVersion plannerReady={true} solverFingerprint={null} />
    <DiagnosticsPanel />
  </main>;
}
