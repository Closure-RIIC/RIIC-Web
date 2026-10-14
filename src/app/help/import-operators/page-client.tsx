"use client";
import { localize as localize_ImportGuide } from "../../../i18n/helpers/ImportGuide.ts";
import type { AppLocale } from "@/i18n/config";

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { ImportGuidePager, type ImportGuidePage } from "@/components/help/ImportGuidePager";
import { ImportMethodChoice } from "@/components/help/ImportMethodChoice";
import { ScreenshotPlaceholder } from "@/components/help/ScreenshotPlaceholder";
import { useLocale } from "use-intl";

function ResultHint({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return (
    <div className="flex items-start gap-3 rounded-[4px] border border-emerald-200 bg-emerald-50/75 p-4 text-sm leading-6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100">
      <span className="mt-2 size-2 shrink-0 bg-emerald-600" aria-hidden="true" />
      <span><strong className="font-semibold">{localize_ImportGuide.text(locale, "doneWhen")}</strong>{children}</span>
    </div>
  );
}

export default function ImportOperatorsHelpPage() {
  const locale = useLocale();

  return (
    <article className="flex w-full flex-col gap-5 pt-5">
      <header>
        <Link className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground underline-offset-4 outline-none hover:underline hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" to="/help">
          <ArrowLeft className="size-3.5" aria-hidden="true" />{localize_ImportGuide.text(locale, "part16")}
        </Link>
        <div className="mt-2 flex min-w-0 items-center gap-2.5">
          <span className="h-7 w-1.5 shrink-0 bg-[#FFD501]" aria-hidden="true" />
          <h1 className="truncate text-[21px] font-medium leading-none text-[#313131]">{localize_ImportGuide.text(locale, "part17")}</h1>
        </div>
      </header>

      <ImportGuidePager pages={guidePages(locale)} />
    </article>
  );
}

function guidePages(locale: AppLocale): ImportGuidePage[] { return [{id: "open-settings",
title: localize_ImportGuide.text(locale, "part1"),
summary: localize_ImportGuide.text(locale, "part2"),
content: localize_ImportGuide.rich(locale, "part3", { element1: (chunks) => (<section className="grid gap-4" aria-label={localize_ImportGuide.text(locale, "detail1")}>{chunks}</section>), element2: (chunks) => (<p className="text-sm leading-6 text-muted-foreground">{chunks}</p>), value3: () => (<ScreenshotPlaceholder
          slot="01"
          title={localize_ImportGuide.text(locale, "detail2")}
          description={localize_ImportGuide.text(locale, "detail3")}
          fileName="help-import-01-open-settings.png"
          src="/images/help/help-import-01-open-settings.png"
          alt={localize_ImportGuide.text(locale, "detail4")}
          imageWidth={1800}
          imageHeight={958}
          highlights={[{ x: 83.2, y: 3.1, width: 8.7, height: 6, label: localize_ImportGuide.text(locale, "detail5") }]}
        />), element4: (chunks) => (<ResultHint>{chunks}</ResultHint>) })},
{id: "change-box",
title: localize_ImportGuide.text(locale, "part4"),
summary: localize_ImportGuide.text(locale, "part5"),
content: localize_ImportGuide.rich(locale, "part6", { element1: (chunks) => (<section className="grid gap-4" aria-label={localize_ImportGuide.text(locale, "detail6")}>{chunks}</section>), element2: (chunks) => (<p className="text-sm leading-6 text-muted-foreground">{chunks}</p>), value3: () => (<ScreenshotPlaceholder
          slot="02"
          title={localize_ImportGuide.text(locale, "detail7")}
          description={localize_ImportGuide.text(locale, "detail8")}
          fileName="help-import-02-change-box.png"
          src="/images/help/help-import-02-change-box.png"
          alt={localize_ImportGuide.text(locale, "detail9")}
          imageWidth={1920}
          imageHeight={1080}
          highlights={[
            { x: 6.6, y: 23.1, width: 4, height: 6.8, label: localize_ImportGuide.text(locale, "detail10") },
            { x: 85.2, y: 38.9, width: 6.8, height: 8.1, label: localize_ImportGuide.text(locale, "detail11") },
          ]}
        />), element4: (chunks) => (<ResultHint>{chunks}</ResultHint>) })},
{id: "choose-source-in-app",
title: localize_ImportGuide.text(locale, "part7"),
summary: localize_ImportGuide.text(locale, "part8"),
content: localize_ImportGuide.rich(locale, "part9", { element1: (chunks) => (<section className="grid gap-4" aria-label={localize_ImportGuide.text(locale, "detail12")}>{chunks}</section>), element2: (chunks) => (<p className="text-sm leading-6 text-muted-foreground">{chunks}</p>), value3: () => (<ScreenshotPlaceholder
          slot="03"
          title={localize_ImportGuide.text(locale, "detail13")}
          description={localize_ImportGuide.text(locale, "detail14")}
          fileName="help-import-03-source-tabs.png"
          src="/images/help/help-import-03-source-tabs.png"
          alt={localize_ImportGuide.text(locale, "detail15")}
          imageWidth={1920}
          imageHeight={1080}
          highlights={[{ x: 8.7, y: 69.4, width: 82.6, height: 7.7, label: localize_ImportGuide.text(locale, "detail16") }]}
        />), element4: (chunks) => (<ResultHint>{chunks}</ResultHint>) })},
{id: "import-methods",
title: localize_ImportGuide.text(locale, "part10"),
summary: localize_ImportGuide.text(locale, "part11"),
content: localize_ImportGuide.rich(locale, "part12", { value1: () => (<ImportMethodChoice
        sklandContent={(
          <section className="grid gap-4 rounded-[4px] border border-border bg-card p-4 sm:p-5" data-help-import-method="skland" aria-labelledby="skland-method-title-en">
            <header className="border-b border-border pb-4"><p className="text-xs font-medium text-muted-foreground">{localize_ImportGuide.text(locale, "detail17")}</p><h3 className="mt-1 text-xl font-semibold" id="skland-method-title-en">{localize_ImportGuide.text(locale, "detail18")}</h3></header>
            <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
              <p><strong className="text-foreground">1.</strong> {localize_ImportGuide.text(locale, "detail19")}</p>
              <p><strong className="text-foreground">2.</strong> {localize_ImportGuide.text(locale, "detail20")}</p>
              <p><strong className="text-foreground">3.</strong> {localize_ImportGuide.text(locale, "detail21")}</p>
              <p><strong className="text-foreground">{localize_ImportGuide.text(locale, "detail22")}</strong> {localize_ImportGuide.text(locale, "detail23")}</p>
            </div>
            <ScreenshotPlaceholder
              slot="04" title={localize_ImportGuide.text(locale, "detail24")} description={localize_ImportGuide.text(locale, "detail25")} fileName="help-import-04-skland-scan.png" src="/images/help/help-import-04-skland-scan.png" alt={localize_ImportGuide.text(locale, "detail26")} imageWidth={2528} imageHeight={1576}
              highlights={[{ x: 31.8, y: 69.6, width: 36.5, height: 14.2, label: localize_ImportGuide.text(locale, "detail27") }, { x: 41.1, y: 37.2, width: 17.8, height: 28.7, label: localize_ImportGuide.text(locale, "detail28") }]}
            />
            <p className="text-sm leading-6 text-muted-foreground">{localize_ImportGuide.text(locale, "detail29")}</p>
            <ScreenshotPlaceholder
              slot="05" title={localize_ImportGuide.text(locale, "detail30")} description={localize_ImportGuide.text(locale, "detail31")} fileName="help-import-05-use-skland.png" src="/images/help/help-import-05-use-skland.png" alt={localize_ImportGuide.text(locale, "detail32")} imageWidth={828} imageHeight={484}
              highlights={[{ x: 3.5, y: 5.2, width: 50.5, height: 40.5, label: localize_ImportGuide.text(locale, "detail33") }, { x: 3.5, y: 50.5, width: 49.5, height: 43, label: localize_ImportGuide.text(locale, "detail34") }]}
            />
            <ResultHint>{localize_ImportGuide.text(locale, "detail35")}</ResultHint>
          </section>
        )}
        maaContent={(
          <section className="grid gap-4 rounded-[4px] border border-border bg-card p-4 sm:p-5" data-help-import-method="maa" aria-labelledby="maa-method-title-en">
            <header className="border-b border-border pb-4"><p className="text-xs font-medium text-muted-foreground">{localize_ImportGuide.text(locale, "detail36")}</p><h3 className="mt-1 text-xl font-semibold" id="maa-method-title-en">{localize_ImportGuide.text(locale, "detail37")}</h3></header>
            <p className="text-sm leading-6 text-muted-foreground">{localize_ImportGuide.text(locale, "detail38")}<code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">Arknights_OperBox_Export.json</code> {localize_ImportGuide.text(locale, "detail39")}</p>
            <ScreenshotPlaceholder
              slot="06" title={localize_ImportGuide.text(locale, "detail40")} description={localize_ImportGuide.text(locale, "detail41")} fileName="help-import-06-maa-export.png" src="/images/help/help-import-06-maa-export.png" alt={localize_ImportGuide.text(locale, "detail42")} imageWidth={1000} imageHeight={562}
              highlights={[{ x: 56.5, y: 8, width: 12.5, height: 10.5, label: localize_ImportGuide.text(locale, "detail43") }, { x: 34.8, y: 17.8, width: 12.5, height: 10.2, label: localize_ImportGuide.text(locale, "detail44") }, { x: 28.5, y: 69.2, width: 20.5, height: 16.5, label: localize_ImportGuide.text(locale, "detail45") }]}
            />
            <p className="text-sm leading-6 text-muted-foreground">{localize_ImportGuide.text(locale, "detail46")}</p>
            <ScreenshotPlaceholder
              slot="07" title={localize_ImportGuide.text(locale, "detail47")} description={localize_ImportGuide.text(locale, "detail48")} fileName="help-import-07-maa-upload.png" src="/images/help/help-import-07-maa-upload.png" alt={localize_ImportGuide.text(locale, "detail49")} imageWidth={1920} imageHeight={1080}
              highlights={[{ x: 49.9, y: 70.4, width: 40.8, height: 5.6, label: localize_ImportGuide.text(locale, "detail50") }, { x: 9, y: 80.5, width: 81.8, height: 19.3, label: localize_ImportGuide.text(locale, "detail51") }]}
            />
            <ResultHint>{localize_ImportGuide.text(locale, "detail52")}</ResultHint>
          </section>
        )}
      />) })},
{id: "finish",
title: localize_ImportGuide.text(locale, "part13"),
summary: localize_ImportGuide.text(locale, "part14"),
content: localize_ImportGuide.rich(locale, "part15", { element1: (chunks) => (<section className="grid gap-4" aria-label={localize_ImportGuide.text(locale, "detail53")}>{chunks}</section>), element2: (chunks) => (<ol className="grid divide-y divide-border border-y border-border text-sm leading-6 text-muted-foreground sm:grid-cols-3 sm:divide-x sm:divide-y-0">{chunks}</ol>), element3: (chunks) => (<li className="p-4">{chunks}</li>), element4: (chunks) => (<strong className="block text-foreground">{chunks}</strong>), element5: (chunks) => (<p className="mt-1">{chunks}</p>) })}]; }
