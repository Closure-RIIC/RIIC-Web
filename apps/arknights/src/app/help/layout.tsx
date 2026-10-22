"use client";
import { useTranslations } from "use-intl";

import type { ReactNode } from "react";

import { HelpBackToTop } from "@/components/help/HelpBackToTop";
import { HelpFloatingNav } from "@/components/help/HelpFloatingNav";
import { InfoPageLayout } from "@/components/layout/InfoPageLayout";

export default function HelpLayout({ children }: { children: ReactNode }) {
  const intl = useTranslations();

  return (
    <InfoPageLayout
      title={intl("app_help_layout.helpCenter")}
      href="/help"
      contentId="help-content"
      floatingControls={<><HelpBackToTop /><HelpFloatingNav /></>}
    >
      {children}
    </InfoPageLayout>
  );
}
