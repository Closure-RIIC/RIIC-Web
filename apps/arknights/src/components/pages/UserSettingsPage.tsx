"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_pages_UserSettingsPage.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_pages_UserSettingsPage");


import { useLocale } from "use-intl";
import { Eye, RotateCcw, SlidersHorizontal, Trash2, Image, PanelTop } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InfraTechnicalCard, InfraTechnicalHeading } from "@/components/InfraTechnicalCard";
import { StatusCenterPage } from "@/components/pages/StatusCenterShell";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { FeatureAccessBoundary } from "@/components/workbench/FeatureAccessProvider";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WebsiteAccountSections } from "@/components/auth/WebsiteAccountPanel";
import { WebsiteSessionSettings } from "@/components/auth/WebsiteSessionSettings";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "@/user-settings";
import { setColorMode, useColorMode } from "@/components/ColorMode";
import { LanguageSwitch } from "@/i18n/client";

const SETTINGS_SWITCH_CLASS = "data-checked:bg-white data-unchecked:bg-white/20 dark:data-unchecked:bg-white/20 [&_[data-slot=switch-thumb]]:bg-white [&_[data-slot=switch-thumb][data-checked]]:bg-[#272a2b]";

interface UserSettingsPageProps {
  settings: UserSettings;
  onSettingsChange: (settings: UserSettings) => void;
  accountSections: WebsiteAccountSections;
}

function SettingsDropdown<T extends string>({ id, label, value, options, disabled = false, onChange }: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <Combobox
      items={options}
      filteredItems={options}
      value={selected}
      inputValue={selected?.label ?? ""}
      itemToStringValue={(option) => option.label}
      isItemEqualToValue={(option, current) => option.value === current.value}
      disabled={disabled}
      onValueChange={(option) => { if (option) onChange(option.value); }}
    >
      <ComboboxInput id={id} aria-label={label} readOnly disabled={disabled} className="h-9 w-44 max-w-[55%] shrink-0 border-white/22 bg-white text-[#242424] shadow-none [&_input]:text-[#242424] dark:bg-[#242424] dark:text-white dark:[&_input]:text-white" />
      <ComboboxContent align="start">
        <ComboboxList>
          {(option) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function UserSettingsPage({ settings, onSettingsChange, accountSections }: UserSettingsPageProps) {
  const en = useLocale();
  const colorMode = useColorMode();
  const [viewControlDetailsOpen, setViewControlDetailsOpen] = useState(!settings.linkShiftViewControl);
  const viewControlOptions: Array<{ value: UserSettings["scheduleViewControl"]; label: string }> = [
    { value: "tabs", label: uiText.text(en, "buttons") },
    { value: "select", label: uiText.text(en, "dropdown") },
  ];
  const resetViewControls = () => onSettingsChange({
    ...settings,
    scheduleViewControl: DEFAULT_USER_SETTINGS.scheduleViewControl,
    linkShiftViewControl: DEFAULT_USER_SETTINGS.linkShiftViewControl,
    shiftViewControl: DEFAULT_USER_SETTINGS.shiftViewControl,
  });
  return (
    <StatusCenterPage className="min-w-0 gap-0 pt-2 pb-8 sm:pb-8 md:pt-5 [&_[data-infra-heading-accent]]:hidden" data-user-settings-page data-account-management>
      <header className="mb-4 flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center md:mb-5" data-settings-header>
        <div className="min-w-0">
          <WorkbenchPageHeading page="settings">{uiText.text(en, "settings")}</WorkbenchPageHeading>
          <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{uiText.text(en, "manageYourAccountSchedulingAndThisSiteS")}</p>
        </div>
        {accountSections.headerProfile}
      </header>
      {accountSections.profile ? <div className="mb-4 md:mb-5">{accountSections.profile}</div> : null}
      <div className="columns-1 gap-3 lg:columns-2 [&_[data-infra-technical-card]]:mb-3 [&_[data-infra-technical-card]]:break-inside-avoid" data-settings-columns>
        <InfraTechnicalCard group="control">
          <section aria-labelledby="settings-scheduling-title" data-settings-group="scheduling">
            <InfraTechnicalHeading icon={<SlidersHorizontal className="size-4" aria-hidden="true" />} titleId="settings-scheduling-title">
              {uiText.text(en, "schedulingAndExport")}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{uiText.text(en, "configureOperatorOrderAndExportedSchedules")}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="strict-maa-operator-order" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "strictOperatorOrder")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "exportOperatorsInTheSameOrderShownIn")}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="strict-maa-operator-order"
                checked={settings.strictMaaOperatorOrder}
                onCheckedChange={(checked) => onSettingsChange({
                  ...settings,
                  strictMaaOperatorOrder: checked,
                })}
                aria-label={uiText.text(en, "strictOperatorOrder")}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="allow-replacement-operator-sort" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "allowReplacementOperatorSorting")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "onlyAllowsMaaToAdjustOperatorOrderInside")}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="allow-replacement-operator-sort"
                checked={settings.allowReplacementOperatorSort}
                onCheckedChange={(checked) => onSettingsChange({
                  ...settings,
                  allowReplacementOperatorSort: checked,
                })}
                aria-label={uiText.text(en, "allowReplacementOperatorSorting")}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="image-export-scope" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "imageExportScope")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "chooseOneShiftOrAllShiftsAllShift")}
                </span>
              </Label>
              <SettingsDropdown<UserSettings["imageExportScope"]>
                id="image-export-scope"
                value={settings.imageExportScope}
                options={[
                  { value: "single", label: uiText.text(en, "oneShift") },
                  { value: "all", label: uiText.text(en, "allShifts") },
                ]}
                onChange={(scope) => onSettingsChange({
                  ...settings,
                  imageExportScope: scope,
                })}
                label={uiText.text(en, "imageExportScope")}
              />
            </div>
            </div>
          </section>
        </InfraTechnicalCard>
        <InfraTechnicalCard group="manufacture">
          <section aria-labelledby="settings-display-title" data-settings-group="display">
            <InfraTechnicalHeading icon={<Eye className="size-4" aria-hidden="true" />} titleId="settings-display-title">
              {uiText.text(en, "appearanceAndInteraction")}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{uiText.text(en, "adjustAppearanceViewSwitchingAndBrowsingBehavior")}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="color-mode" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "appearanceMode")}</span>
                <span className="font-normal text-sm text-white/64">{uiText.text(en, "chooseDayOrNightModeForThisSite")}</span>
              </Label>
              <SettingsDropdown id="color-mode" label={uiText.text(en, "appearanceMode")} value={colorMode}
                options={[{ value: "light", label: uiText.text(en, "dayMode") }, { value: "dark", label: uiText.text(en, "nightMode") }]}
                onChange={setColorMode} />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <span className="text-sm">{uiText.text(en, "language")}</span>
              <LanguageSwitch />
            </div>
            <div className="grid gap-3 border-t border-white/12 pt-4">
              <div className="flex items-center justify-between gap-6">
              <Label htmlFor="schedule-view-control" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "scheduleViewControl")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "chooseButtonsOrADropdownForOverviewAnd")}
                </span>
              </Label>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="outline" size="icon" className="size-9 border-white/22 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => setViewControlDetailsOpen((open) => !open)} aria-label={uiText.text(en, "detailedControls")} title={uiText.text(en, "detailedControls")}>
                  <SlidersHorizontal />
                </Button>
              </div>
              </div>
              {viewControlDetailsOpen ? (
                <div className="grid gap-3 rounded-md border border-white/15 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium">{uiText.text(en, "detailedControls")}</div>
                    <Button type="button" variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={resetViewControls}>
                      <RotateCcw />{uiText.text(en, "restoreDefaults")}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <Label htmlFor="link-shift-view-control" className="grid min-w-0 gap-1">
                      <span>{uiText.text(en, "useOneSettingForAll")}</span>
                      <span className="font-normal text-sm text-white/64">
                        {uiText.text(en, "disableThisToTuneOverviewListAndShift")}
                      </span>
                    </Label>
                    <Switch className={SETTINGS_SWITCH_CLASS}
                      id="link-shift-view-control"
                      checked={settings.linkShiftViewControl}
                      onCheckedChange={(checked) => onSettingsChange({
                        ...settings,
                        linkShiftViewControl: checked,
                        shiftViewControl: checked ? settings.scheduleViewControl : settings.shiftViewControl,
                      })}
                      aria-label={uiText.text(en, "useOneSettingForAll")}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <Label htmlFor="schedule-view-control-detail" className="grid min-w-0 gap-1">
                      <span>{uiText.text(en, "overviewList")}</span>
                    </Label>
                    <SettingsDropdown
                      id="schedule-view-control-detail"
                      value={settings.scheduleViewControl}
                      options={viewControlOptions}
                      onChange={(control) => {
                        onSettingsChange({
                          ...settings,
                          scheduleViewControl: control,
                          shiftViewControl: settings.linkShiftViewControl ? control : settings.shiftViewControl,
                        });
                      }}
                      label={uiText.text(en, "overviewAndListControl")}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <Label htmlFor="shift-view-control" className="grid min-w-0 gap-1">
                      <span>{uiText.text(en, "shiftViewControl")}</span>
                      <span className="font-normal text-sm text-white/64">
                        {uiText.text(en, "chooseButtonsOrADropdownForSwitchingBetween")}
                      </span>
                    </Label>
                    <SettingsDropdown
                      id="shift-view-control"
                      value={settings.linkShiftViewControl ? settings.scheduleViewControl : settings.shiftViewControl}
                      options={viewControlOptions}
                      disabled={settings.linkShiftViewControl}
                      onChange={(control) => onSettingsChange({
                        ...settings,
                        shiftViewControl: control,
                      })}
                      label={uiText.text(en, "shiftViewControl")}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="skill-pagination" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "skillPageLoading")}</span>
                <span className="font-normal text-sm text-white/64">{uiText.text(en, "infiniteScrollOrClickAfterTenResults")}</span>
              </Label>
              <SettingsDropdown<UserSettings["skillPagination"]>
                id="skill-pagination"
                value={settings.skillPagination}
                options={[
                  { value: "infinite", label: uiText.text(en, "infiniteScroll") },
                  { value: "manual", label: uiText.text(en, "clickEveryTen") },
                ]}
                onChange={(mode) => onSettingsChange({ ...settings, skillPagination: mode })}
                label={uiText.text(en, "skillPageLoading")}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="highlight-no-layout-skill" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "highlightOperatorsWithoutLayoutSkills")}</span>
                <span className="font-normal text-sm text-white/64">{uiText.text(en, "highlightOperatorsWithNoUnlockedInfrastructureSkillMatching")}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="highlight-no-layout-skill" checked={settings.highlightNoLayoutSkill} onCheckedChange={(checked) => onSettingsChange({ ...settings, highlightNoLayoutSkill: checked })} aria-label={uiText.text(en, "highlightOperatorsWithoutLayoutSkills")} />
            </div>
            </div>
          </section>
        </InfraTechnicalCard>
        <InfraTechnicalCard group="meeting">
          <section aria-labelledby="settings-features-title" data-settings-group="features">
            <InfraTechnicalHeading icon={<PanelTop className="size-4" aria-hidden="true" />} titleId="settings-features-title">
              {uiText.text(en, "featureShortcuts")}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{uiText.text(en, "chooseTheToolsAndActionButtonsShownIn")}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="show-progression-recalculate" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "showProgressionRecalculation")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "showTheButtonForSimulatingHigherOperatorLevels")}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="show-progression-recalculate"
                checked={settings.showProgressionRecalculate}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, showProgressionRecalculate: checked })}
                aria-label={uiText.text(en, "showProgressionRecalculation")}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-manual-schedule-edit" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "showCurrentPlanEditor")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "showTheButtonForOpeningTheManualSchedule")}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="show-manual-schedule-edit"
                checked={settings.showManualScheduleEdit}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, showManualScheduleEdit: checked })}
                aria-label={uiText.text(en, "showCurrentPlanEditor")}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-mower" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "showMower")}</span>
                <span className="font-normal text-sm text-white/64">
                  {uiText.text(en, "mowerScheduleImportAndExportInManualScheduling")}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="show-mower"
                checked={settings.showMower}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, showMower: checked })}
                aria-label={uiText.text(en, "showMower")}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-feedback" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "showFeedbackButtons")}</span>
                <span className="font-normal text-sm text-white/64">{uiText.text(en, "showIssueAndPerformanceFeedbackActions")}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="show-feedback" checked={settings.showFeedback} onCheckedChange={(checked) => onSettingsChange({ ...settings, showFeedback: checked })} aria-label={uiText.text(en, "showFeedbackButtons")} />
            </div>
            <FeatureAccessBoundary feature="agent">
              <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
                <Label htmlFor="show-floating-agent" className="grid min-w-0 gap-1">
                  <span>{uiText.text(en, "showFloatingAssistant")}</span>
                  <span className="font-normal text-sm text-white/64">{uiText.text(en, "showClosureInTheCornerOfThePage")}</span>
                </Label>
                <Switch className={SETTINGS_SWITCH_CLASS}
                  id="show-floating-agent"
                  checked={settings.showFloatingAgent}
                  onCheckedChange={(checked) => onSettingsChange({ ...settings, showFloatingAgent: checked })}
                  aria-label={uiText.text(en, "showFloatingAssistant")}
                />
              </div>
            </FeatureAccessBoundary>
            </div>
          </section>
        </InfraTechnicalCard>
        <InfraTechnicalCard group="processing">
          <section aria-labelledby="settings-resources-title" data-settings-group="resources">
            <InfraTechnicalHeading icon={<Image className="size-4" aria-hidden="true" />} titleId="settings-resources-title">
              {uiText.text(en, "resourceLoading")}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{uiText.text(en, "chooseWhichImagesAndLanguageResourcesToLoad")}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="load-english-resources" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "loadEnglishResources")}</span>
                <span className="font-normal text-sm text-white/64">{uiText.text(en, "whenOffEnglishGameDataIsNotRequested")}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="load-english-resources" checked={settings.loadEnglishResources} onCheckedChange={(checked) => onSettingsChange({ ...settings, loadEnglishResources: checked })} aria-label={uiText.text(en, "loadEnglishResources")} />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-images" className="grid min-w-0 gap-1">
                <span>{uiText.text(en, "loadOperatorImages")}</span>
                <span className="font-normal text-sm text-white/64">{uiText.text(en, "whenOffShowNamesWithoutLoadingPortraits")}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="show-images" checked={settings.showImages} onCheckedChange={(checked) => onSettingsChange({ ...settings, showImages: checked })} aria-label={uiText.text(en, "loadOperatorImages")} />
            </div>
            </div>
          </section>
        </InfraTechnicalCard>
        {accountSections.securityActions ? <WebsiteSessionSettings actions={accountSections.securityActions} /> : null}
        <section className="contents" aria-labelledby="settings-data-title" data-settings-group="data">
          <h2 id="settings-data-title" className="sr-only">{uiText.text(en, "dataAndSync")}</h2>
          {accountSections.cloudData}
          <InfraTechnicalCard group="processing">
            <section aria-labelledby="settings-local-data-title">
              <InfraTechnicalHeading icon={<Trash2 className="size-4" aria-hidden="true" />} titleId="settings-local-data-title">
                {uiText.text(en, "arknightsLocalCache")}
              </InfraTechnicalHeading>
                <div className="mt-4">
                  <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
                    <div className="grid min-w-0 gap-1">
                      <span className="font-medium">{uiText.text(en, "clearLocalCacheData")}</span>
                      <span className="text-sm text-white/64">{uiText.text(en, "clearsArknightsSchedulesDraftsBoxLayoutDataSettings")}</span>
                    </div>
                    <Button type="button" variant="destructive" size="dialog" className="w-full shrink-0 sm:w-auto" onClick={() => {
                      const message = uiText.text(en, "clearArknightsLocalDataAndBrowserCacheEndfield");
                      if (!window.confirm(message)) return;
                      window.localStorage.clear();
                      window.sessionStorage.clear();
                      void window.caches?.keys().then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))));
                      window.location.reload();
                    }}>
                      <RotateCcw />{uiText.text(en, "clearData")}
                    </Button>
                  </div>
                </div>
            </section>
          </InfraTechnicalCard>
        </section>
        {accountSections.deleteAccount}
      </div>
    </StatusCenterPage>
  );
}
