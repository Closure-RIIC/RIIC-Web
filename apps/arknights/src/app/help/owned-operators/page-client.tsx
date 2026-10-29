"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../../messages/zh-CN/AK_Raw_app_help_owned_operators_page_client.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_app_help_owned_operators_page_client");

import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { IssueSolutionPicker } from "@/components/help/IssueSolutionPicker";

const steps = [
  { content: "app_help_owned_operators_page_content" as const },
  { content: "app_help_owned_operators_page_content2" as const },
  { content: "app_help_owned_operators_page_content3" as const },
  { content: "app_help_owned_operators_page_content4" as const },
  { content: "app_help_owned_operators_page_content5" as const },
];

export default function OwnedOperatorsHelpPage() {
  const rawLocale = useRawLocale();
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  return (
    <article className="flex w-full flex-col gap-5 pt-5">
      <header>
        <Link className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground underline-offset-4 outline-none hover:underline hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" to="/help">
          <ArrowLeft className="size-3.5" aria-hidden="true" />{intl("app_help_owned_operators_page.backToHelp")}
        </Link>
        <div className="mt-2 flex min-w-0 items-center gap-2.5">
          <span className="h-7 w-1.5 shrink-0 bg-[#FFD501]" aria-hidden="true" />
          <h1 className="truncate text-[21px] font-medium leading-none text-[#313131]">{intl("app_help_owned_operators_page.useTheOperatorsYouOwn")}</h1>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{intl("app_help_owned_operators_page.useThisGuideIfYouLoadedTheAllOperator")}</p>
      </header>

      <IssueSolutionPicker>
      <div className="grid gap-7 rounded-[4px] border border-border bg-background p-4 sm:p-5">
        <section className="rounded-[4px] border border-amber-300 bg-amber-50 p-4 text-amber-950" aria-labelledby="sample-warning-title">
          <h2 id="sample-warning-title" className="text-lg font-semibold">{intl("app_help_owned_operators_page.firstCheckWhetherTheSourceIs243MaxLevel")}</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">{intl("app_help_owned_operators_page.ifSoSeeingOperatorsYouDoNotOwnIs")}</p>
        </section>

        <section aria-labelledby="switch-steps-title">
          <h2 id="switch-steps-title" className="text-lg font-semibold">{intl("app_help_owned_operators_page.switchStepByStep")}</h2>
          <ol className="mt-3 divide-y divide-border border-y border-border">
            {steps.map((step, index) => {
              const [title, description] = messageRecord(en, step.content).value;
              return <li key={index} className="grid gap-3 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                <span className="font-number text-sm text-[#313131]/38" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </li>;
            })}
          </ol>
        </section>

        <section aria-labelledby="import-method-title" className="hidden">
          <h2 id="import-method-title" className="text-3xl font-semibold sm:text-4xl">{rawText.text(rawLocale, "twoWaysToImport")}</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="skland-method-title">
              <h3 id="skland-method-title" className="text-2xl font-semibold">{rawText.text(rawLocale, "sklandSync")}</h3>
              <ol className="mt-4 grid gap-3 text-lg leading-8 text-muted-foreground">
                <li>{rawText.rich(rawLocale, "selectGoToSklandSync", { part1: richValue((<strong className="text-foreground">1.</strong>)) })}</li>
                <li>{rawText.rich(rawLocale, "readAndAcceptBothAgreements", { part1: richValue((<strong className="text-foreground">2.</strong>)) })}</li>
                <li>{rawText.rich(rawLocale, "scanTheQrCodeWithTheSklandAppThen", { part1: richValue((<strong className="text-foreground">3.</strong>)) })}</li>
                <li>{rawText.rich(rawLocale, "yourRosterIsAppliedAutomaticallyAfterAuthorizationThenChoose", { part1: richValue((<strong className="text-foreground">4.</strong>)) })}</li>
              </ol>
              <p className="mt-5 rounded-lg bg-muted/60 p-4 text-base leading-7 text-muted-foreground">{rawText.text(rawLocale, "refreshAnExpiredQrCodeIfSyncingIsUnavailable")}</p>
            </section>

            <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="maa-method-title">
              <h3 id="maa-method-title" className="text-2xl font-semibold">{rawText.text(rawLocale, "importFromMaa")}</h3>
              <ol className="mt-4 grid gap-3 text-lg leading-8 text-muted-foreground">
                <li>{rawText.rich(rawLocale, "exportYourOperatorDataFromMaa", { part1: richValue((<strong className="text-foreground">1.</strong>)) })}</li>
                <li>{rawText.rich(rawLocale, "upload", { part1: richValue((<strong className="text-foreground">2.</strong>)), part2: richValue((<code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">Arknights_OperBox_Export.json</code>)) })}</li>
                <li>{rawText.rich(rawLocale, "youCanAlsoExpandPasteJsonAndImportThe", { part1: richValue((<strong className="text-foreground">3.</strong>)) })}</li>
              </ol>
              <p className="mt-5 rounded-lg bg-muted/60 p-4 text-base leading-7 text-muted-foreground">{rawText.text(rawLocale, "doNotUploadAScheduleFileOrMaaSchedule")}</p>
            </section>
          </div>
          <Link className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-lg border border-border px-5 text-lg font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" to="/help/import-operators">{rawText.rich(rawLocale, "viewTheDetailedImportTutorialWithScreenshots", { part1: richValue((<ArrowRight className="size-4" aria-hidden="true" />)) })}</Link>
        </section>

        <section aria-labelledby="source-check-title" className="hidden">
          <h2 id="source-check-title" className="text-3xl font-semibold sm:text-4xl">{rawText.text(rawLocale, "checkThatTheRosterChanged")}</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <table className="w-full border-collapse text-left text-base sm:text-lg">
              <thead className="bg-muted/70 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">{rawText.text(rawLocale, "currentDataSource")}</th><th className="px-4 py-3 font-medium">{rawText.text(rawLocale, "whatItMeans")}</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><td className="px-4 py-3 font-medium">{rawText.text(rawLocale, "243FullE2Sample")}</td><td className="px-4 py-3 text-muted-foreground">{rawText.text(rawLocale, "youAreStillUsingSampleDataNotYourOwn")}</td></tr>
                <tr><td className="px-4 py-3 font-medium">{rawText.text(rawLocale, "sklandLastSyncedSklandData")}</td><td className="px-4 py-3 text-muted-foreground">{rawText.text(rawLocale, "yourSklandCharacterDataIsInUse")}</td></tr>
                <tr><td className="px-4 py-3 font-medium">{rawText.text(rawLocale, "jsonFilenameMaaImport")}</td><td className="px-4 py-3 text-muted-foreground">{rawText.text(rawLocale, "yourMaaOperatorDataIsInUse")}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-5 text-lg leading-8 text-sky-950">
            <strong className="text-xl">{rawText.text(rawLocale, "differentCountsDoNotNecessarilyMeanTheImportFailed")}</strong>
            <p className="mt-2 text-sky-900">{rawText.text(rawLocale, "forMaaFilesCompareTheAvailableOperatorCountFirst")}</p>
          </div>
        </section>

        <section aria-labelledby="recovery-title" className="hidden">
          <h2 id="recovery-title" className="text-3xl font-semibold sm:text-4xl">{rawText.text(rawLocale, "unownedOperatorsStillAppear")}</h2>
          <ol className="mt-5 grid gap-3 text-lg leading-8 text-muted-foreground">
            <li>{rawText.rich(rawLocale, "checkThatTheCurrentDataInTheDialogIs", { part1: richValue((<strong className="text-foreground">1.</strong>)) })}</li>
            <li>{rawText.rich(rawLocale, "checkThatTheAvailableCountIsNotADifference", { part1: richValue((<strong className="text-foreground">2.</strong>)), part2: richValue((<span className="font-number">0</span>)) })}</li>
            <li>{rawText.rich(rawLocale, "afterSelectingDoneGenerateANewScheduleInsteadOf", { part1: richValue((<strong className="text-foreground">3.</strong>)) })}</li>
            <li>{rawText.rich(rawLocale, "ifTheProblemPersistsExportAFreshRosterAnd", { part1: richValue((<strong className="text-foreground">4.</strong>)) })}</li>
          </ol>
        </section>

        <section className="hidden flex-wrap items-center justify-between gap-4 rounded-xl bg-foreground p-5 text-background" aria-label={rawText.text(rawLocale, "backToCalculator")}>
          <div><strong className="block text-2xl">{rawText.text(rawLocale, "readyToGo")}</strong><p className="mt-2 text-lg text-background/75">{rawText.text(rawLocale, "returnToTheCalculatorReplaceTheRosterAndGenerate")}</p></div>
          <Link className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-background px-5 text-lg font-semibold text-foreground outline-none hover:bg-background/90 focus-visible:ring-2 focus-visible:ring-background" to="/">{rawText.text(rawLocale, "backToCalculator2")}</Link>
        </section>
      </div>
      </IssueSolutionPicker>
    </article>
  );
}
