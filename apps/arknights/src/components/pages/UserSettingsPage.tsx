"use client";

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
  const en = useLocale() === "en";
  const colorMode = useColorMode();
  const [viewControlDetailsOpen, setViewControlDetailsOpen] = useState(!settings.linkShiftViewControl);
  const viewControlOptions: Array<{ value: UserSettings["scheduleViewControl"]; label: string }> = [
    { value: "tabs", label: en ? "Buttons" : "按钮" },
    { value: "select", label: en ? "Dropdown" : "下拉表单" },
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
          <WorkbenchPageHeading page="settings">{en ? "Settings" : "设置"}</WorkbenchPageHeading>
          <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{en ? "Manage your account, scheduling and this site's display preferences." : "管理账号、排班与当前站点的显示偏好。"}</p>
        </div>
        {accountSections.headerProfile}
      </header>
      {accountSections.profile ? <div className="mb-4 md:mb-5">{accountSections.profile}</div> : null}
      <div className="columns-1 gap-3 lg:columns-2 [&_[data-infra-technical-card]]:mb-3 [&_[data-infra-technical-card]]:break-inside-avoid" data-settings-columns>
        <InfraTechnicalCard group="control">
          <section aria-labelledby="settings-scheduling-title" data-settings-group="scheduling">
            <InfraTechnicalHeading icon={<SlidersHorizontal className="size-4" aria-hidden="true" />} titleId="settings-scheduling-title">
              {en ? "Scheduling and export" : "排班与导出"}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{en ? "Configure operator order and exported schedules." : "设置干员入驻顺序与排班导出。"}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="strict-maa-operator-order" className="grid min-w-0 gap-1">
                <span>{en ? "Strict operator order" : "严格按照顺序入驻"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en
                    ? "Export operators in the same order shown in the schedule. Enabling this can make MAA take longer to fill rooms."
                    : "导出到 MAA 时，按前端排班中显示的顺序依次入驻；开启后 MAA 填写时间可能变长。"}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="strict-maa-operator-order"
                checked={settings.strictMaaOperatorOrder}
                onCheckedChange={(checked) => onSettingsChange({
                  ...settings,
                  strictMaaOperatorOrder: checked,
                })}
                aria-label={en ? "Strict operator order" : "严格按照顺序入驻"}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="allow-replacement-operator-sort" className="grid min-w-0 gap-1">
                <span>{en ? "Allow replacement operator sorting" : "替换排班允许调整干员顺序"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en
                    ? "Only allows MAA to adjust operator order inside the same facility when replacing a schedule. Off by default."
                    : "仅允许替换排班时在同一设施内调整干员顺序；默认关闭。"}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="allow-replacement-operator-sort"
                checked={settings.allowReplacementOperatorSort}
                onCheckedChange={(checked) => onSettingsChange({
                  ...settings,
                  allowReplacementOperatorSort: checked,
                })}
                aria-label={en ? "Allow replacement operator sorting" : "替换排班允许调整干员顺序"}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="image-export-scope" className="grid min-w-0 gap-1">
                <span>{en ? "Image export scope" : "导出图片范围"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en ? "Choose one shift or all shifts. All-shift export is currently under maintenance." : "选择导出一班或全班；全班导出目前维护中。"}
                </span>
              </Label>
              <SettingsDropdown<UserSettings["imageExportScope"]>
                id="image-export-scope"
                value={settings.imageExportScope}
                options={[
                  { value: "single", label: en ? "One shift" : "一班" },
                  { value: "all", label: en ? "All shifts" : "全班" },
                ]}
                onChange={(scope) => onSettingsChange({
                  ...settings,
                  imageExportScope: scope,
                })}
                label={en ? "Image export scope" : "导出图片范围"}
              />
            </div>
            </div>
          </section>
        </InfraTechnicalCard>
        <InfraTechnicalCard group="manufacture">
          <section aria-labelledby="settings-display-title" data-settings-group="display">
            <InfraTechnicalHeading icon={<Eye className="size-4" aria-hidden="true" />} titleId="settings-display-title">
              {en ? "Appearance and interaction" : "界面与交互"}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{en ? "Adjust appearance, view switching and browsing behavior." : "调整外观、视图切换与浏览方式。"}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="color-mode" className="grid min-w-0 gap-1">
                <span>{en ? "Appearance mode" : "外观模式"}</span>
                <span className="font-normal text-sm text-white/64">{en ? "Choose day or night mode for this site. Endfield keeps its own preference." : "设置当前站点的日间与夜间模式，终末地独立保存自己的偏好。"}</span>
              </Label>
              <SettingsDropdown id="color-mode" label={en ? "Appearance mode" : "外观模式"} value={colorMode}
                options={[{ value: "light", label: en ? "Day mode" : "日间模式" }, { value: "dark", label: en ? "Night mode" : "夜间模式" }]}
                onChange={setColorMode} />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <span className="text-sm">{en ? "Language" : "语言"}</span>
              <LanguageSwitch />
            </div>
            <div className="grid gap-3 border-t border-white/12 pt-4">
              <div className="flex items-center justify-between gap-6">
              <Label htmlFor="schedule-view-control" className="grid min-w-0 gap-1">
                <span>{en ? "Schedule view control" : "排班视图切换方式"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en ? "Choose buttons or a dropdown for overview and list." : "选择“一图流 / 列表式”使用按钮还是下拉表单。"}
                </span>
              </Label>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="outline" size="icon" className="size-9 border-white/22 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => setViewControlDetailsOpen((open) => !open)} aria-label={en ? "Detailed controls" : "细致调整"} title={en ? "Detailed controls" : "细致调整"}>
                  <SlidersHorizontal />
                </Button>
              </div>
              </div>
              {viewControlDetailsOpen ? (
                <div className="grid gap-3 rounded-md border border-white/15 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium">{en ? "Detailed controls" : "细致调整"}</div>
                    <Button type="button" variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={resetViewControls}>
                      <RotateCcw />{en ? "Restore defaults" : "恢复默认"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <Label htmlFor="link-shift-view-control" className="grid min-w-0 gap-1">
                      <span>{en ? "Use one setting for all" : "统一使用总设置"}</span>
                      <span className="font-normal text-sm text-white/64">
                        {en ? "Disable this to tune overview/list and shift switching separately." : "关闭后可分别调整“一图流 / 列表式”和“多班制”。"}
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
                      aria-label={en ? "Use one setting for all" : "统一使用总设置"}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <Label htmlFor="schedule-view-control-detail" className="grid min-w-0 gap-1">
                      <span>{en ? "Overview / list" : "一图流 / 列表式"}</span>
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
                      label={en ? "Overview and list control" : "一图流和列表式控件"}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <Label htmlFor="shift-view-control" className="grid min-w-0 gap-1">
                      <span>{en ? "Shift view control" : "多班制切换方式"}</span>
                      <span className="font-normal text-sm text-white/64">
                        {en ? "Choose buttons or a dropdown for switching between shifts." : "单独选择“第 1 班 / 第 2 班…”使用按钮还是下拉表单。"}
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
                      label={en ? "Shift view control" : "多班制切换方式"}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="skill-pagination" className="grid min-w-0 gap-1">
                <span>{en ? "Skill page loading" : "技能页加载方式"}</span>
                <span className="font-normal text-sm text-white/64">{en ? "Infinite scroll or click after ten results." : "无限下滚，或每显示十条后点击继续下滚。"}</span>
              </Label>
              <SettingsDropdown<UserSettings["skillPagination"]>
                id="skill-pagination"
                value={settings.skillPagination}
                options={[
                  { value: "infinite", label: en ? "Infinite scroll" : "无限下滚" },
                  { value: "manual", label: en ? "Click every ten" : "每十条点击加载" },
                ]}
                onChange={(mode) => onSettingsChange({ ...settings, skillPagination: mode })}
                label={en ? "Skill page loading" : "技能页加载方式"}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="highlight-no-layout-skill" className="grid min-w-0 gap-1">
                <span>{en ? "Highlight operators without layout skills" : "高亮当前布局无功能干员"}</span>
                <span className="font-normal text-sm text-white/64">{en ? "Highlight operators with no unlocked infrastructure skill matching a facility in the current layout. Off by default." : "高亮当前基建布局内没有已解锁且适配设施类型的基建技能的干员，默认关闭。"}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="highlight-no-layout-skill" checked={settings.highlightNoLayoutSkill} onCheckedChange={(checked) => onSettingsChange({ ...settings, highlightNoLayoutSkill: checked })} aria-label={en ? "Highlight operators without layout skills" : "高亮当前布局无功能干员"} />
            </div>
            </div>
          </section>
        </InfraTechnicalCard>
        <InfraTechnicalCard group="meeting">
          <section aria-labelledby="settings-features-title" data-settings-group="features">
            <InfraTechnicalHeading icon={<PanelTop className="size-4" aria-hidden="true" />} titleId="settings-features-title">
              {en ? "Feature shortcuts" : "功能入口"}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{en ? "Choose the tools and action buttons shown in the workspace." : "选择工作区中显示的工具与操作按钮。"}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="show-progression-recalculate" className="grid min-w-0 gap-1">
                <span>{en ? "Show progression recalculation" : "显示修改练度并重算"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en ? "Show the button for simulating higher operator levels." : "控制“修改练度并重算”按钮是否显示。"}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="show-progression-recalculate"
                checked={settings.showProgressionRecalculate}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, showProgressionRecalculate: checked })}
                aria-label={en ? "Show progression recalculation" : "显示修改练度并重算"}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-manual-schedule-edit" className="grid min-w-0 gap-1">
                <span>{en ? "Show current plan editor" : "显示基于当前方案编辑"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en ? "Show the button for opening the manual schedule editor." : "控制“基于当前方案编辑”按钮是否显示。"}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="show-manual-schedule-edit"
                checked={settings.showManualScheduleEdit}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, showManualScheduleEdit: checked })}
                aria-label={en ? "Show current plan editor" : "显示基于当前方案编辑"}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-mower" className="grid min-w-0 gap-1">
                <span>{en ? "Show Mower" : "显示 Mower"}</span>
                <span className="font-normal text-sm text-white/64">
                  {en ? "Mower schedule import and export in manual scheduling. Off by default." : "在手动排班中显示 Mower 导入导出入口，默认关闭。"}
                </span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS}
                id="show-mower"
                checked={settings.showMower}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, showMower: checked })}
                aria-label={en ? "Show Mower" : "显示 Mower"}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-feedback" className="grid min-w-0 gap-1">
                <span>{en ? "Show feedback buttons" : "显示反馈按钮"}</span>
                <span className="font-normal text-sm text-white/64">{en ? "Show issue and performance feedback actions." : "控制排班结果中的问题反馈和性能反馈按钮。"}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="show-feedback" checked={settings.showFeedback} onCheckedChange={(checked) => onSettingsChange({ ...settings, showFeedback: checked })} aria-label={en ? "Show feedback buttons" : "显示反馈按钮"} />
            </div>
            <FeatureAccessBoundary feature="agent">
              <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
                <Label htmlFor="show-floating-agent" className="grid min-w-0 gap-1">
                  <span>{en ? "Show floating assistant" : "显示悬浮助理"}</span>
                  <span className="font-normal text-sm text-white/64">{en ? "Show Closure in the corner of the page. You can still open the assistant from the sidebar when this is off." : "在页面角落显示可露希尔助理，关闭后仍可从侧边栏打开助理页面。"}</span>
                </Label>
                <Switch className={SETTINGS_SWITCH_CLASS}
                  id="show-floating-agent"
                  checked={settings.showFloatingAgent}
                  onCheckedChange={(checked) => onSettingsChange({ ...settings, showFloatingAgent: checked })}
                  aria-label={en ? "Show floating assistant" : "显示悬浮助理"}
                />
              </div>
            </FeatureAccessBoundary>
            </div>
          </section>
        </InfraTechnicalCard>
        <InfraTechnicalCard group="processing">
          <section aria-labelledby="settings-resources-title" data-settings-group="resources">
            <InfraTechnicalHeading icon={<Image className="size-4" aria-hidden="true" />} titleId="settings-resources-title">
              {en ? "Resource loading" : "资源加载"}
            </InfraTechnicalHeading>
            <p className="mt-4 text-sm leading-6 text-white/64">{en ? "Choose which images and language resources to load." : "选择需要加载的图片与语言资源。"}</p>
            <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between gap-6">
              <Label htmlFor="load-english-resources" className="grid min-w-0 gap-1">
                <span>{en ? "Load English resources" : "加载英文资源"}</span>
                <span className="font-normal text-sm text-white/64">{en ? "When off, English game data is not requested." : "关闭后不请求英文干员名、房间名和技能数据。"}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="load-english-resources" checked={settings.loadEnglishResources} onCheckedChange={(checked) => onSettingsChange({ ...settings, loadEnglishResources: checked })} aria-label={en ? "Load English resources" : "加载英文资源"} />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-white/12 pt-4">
              <Label htmlFor="show-images" className="grid min-w-0 gap-1">
                <span>{en ? "Load operator images" : "加载干员图片"}</span>
                <span className="font-normal text-sm text-white/64">{en ? "When off, show names without loading portraits." : "关闭后只显示干员名字，不加载头像图片。"}</span>
              </Label>
              <Switch className={SETTINGS_SWITCH_CLASS} id="show-images" checked={settings.showImages} onCheckedChange={(checked) => onSettingsChange({ ...settings, showImages: checked })} aria-label={en ? "Load operator images" : "加载干员图片"} />
            </div>
            </div>
          </section>
        </InfraTechnicalCard>
        {accountSections.securityActions ? <WebsiteSessionSettings actions={accountSections.securityActions} /> : null}
        <section className="contents" aria-labelledby="settings-data-title" data-settings-group="data">
          <h2 id="settings-data-title" className="sr-only">{en ? "Data and sync" : "数据与同步"}</h2>
          {accountSections.cloudData}
          <InfraTechnicalCard group="processing">
            <section aria-labelledby="settings-local-data-title">
              <InfraTechnicalHeading icon={<Trash2 className="size-4" aria-hidden="true" />} titleId="settings-local-data-title">
                {en ? "Arknights · Local cache" : "明日方舟 · 本地缓存"}
              </InfraTechnicalHeading>
                <div className="mt-4">
                  <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
                    <div className="grid min-w-0 gap-1">
                      <span className="font-medium">{en ? "Clear local cache data" : "清除本地缓存数据"}</span>
                      <span className="text-sm text-white/64">{en ? "Clears Arknights schedules, drafts, BOX/layout data, settings and browser cache. Endfield data is not affected." : "清除明日方舟的本地排班、草稿、BOX/布局数据、设置和浏览器缓存，不影响终末地数据。"}</span>
                    </div>
                    <Button type="button" variant="destructive" size="dialog" className="w-full shrink-0 sm:w-auto" onClick={() => {
                      const message = en ? "Clear Arknights local data and browser cache? Endfield data will be kept." : "将清除明日方舟的本地数据和浏览器缓存，终末地数据会保留。继续吗？";
                      if (!window.confirm(message)) return;
                      window.localStorage.clear();
                      window.sessionStorage.clear();
                      void window.caches?.keys().then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))));
                      window.location.reload();
                    }}>
                      <RotateCcw />{en ? "Clear data" : "清除数据"}
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
