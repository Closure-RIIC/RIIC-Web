"use client";

import { UserSettingsPage } from "@/components/pages/UserSettingsPage";
import { WebsiteAccountPanel } from "@/components/auth/WebsiteAccountPanel";
import { useWorkbench } from "@/workbench-context";

export function SettingsRoute() {
  const { settings, account } = useWorkbench();
  return <WebsiteAccountPanel {...account} renderSections={(sections) => (
    <UserSettingsPage settings={settings.value} onSettingsChange={settings.onChange} accountSections={sections} />
  )} />;
}
