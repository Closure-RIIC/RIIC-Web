import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OperBoxEntry } from "@riic/arknights-domain/types";
import type { GalleryEntry } from "@/schedule-gallery";
import { compareGalleryBox, operatorKey } from "@/gallery-publishing";
import { GalleryBoxPicker, type ComparisonBoxFile } from "./GalleryBoxPicker";

export function GalleryBoxComparison({ entry, box, choices, onChoice, onConfigure, boxName, customBox, onSelectBox, onResetBox }: {
  entry: GalleryEntry; box: OperBoxEntry[] | null; choices: Record<string, string>;
  onChoice: (primary: string, backup: string) => void; onConfigure: () => void;
  boxName: string; customBox: boolean; onSelectBox: (box: ComparisonBoxFile) => void; onResetBox: () => void;
}) {
  const t = useTranslations("ScheduleGallery");
  const comparison = box?.length ? compareGalleryBox(entry.document, box, entry.authorBox) : null;
  const owned = new Set(box?.filter(operator => operator.own).map(operatorKey));
  return <div className="space-y-5 rounded-lg border border-border p-4" data-gallery-comparison>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("boxComparison")}</h3><Button size="sm" variant="outline" onClick={onConfigure}>{t("configureBox")}</Button></div>
    <div className="space-y-3 rounded-lg bg-muted/30 p-3"><p className="break-all text-sm" data-comparison-box-name>{t("comparingBox", { name: boxName })}</p><div className="flex flex-wrap gap-2"><GalleryBoxPicker nested onSelect={onSelectBox} />{customBox && <Button variant="ghost" onClick={onResetBox}>{t("useCurrentBox")}</Button>}</div><p className="text-xs leading-5 text-muted-foreground">{t("comparisonPrivate")}</p></div>
    {comparison ? <>
      <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded bg-muted p-3"><strong className="block text-xl">{comparison.required}</strong><span className="text-xs">{t("requiredCount")}</span></div><div className="rounded bg-muted p-3"><strong className="block text-xl">{comparison.missing.length}</strong><span className="text-xs">{t("missingCount")}</span></div><div className="rounded bg-muted p-3"><strong className="block text-xl">{comparison.lowerTraining.length}</strong><span className="text-xs">{t("lowerCount")}</span></div></div>
      <div className="flex flex-wrap gap-2">{comparison.missing.map(name => <Badge variant="outline" key={name}>{name}</Badge>)}{!comparison.missing.length && <p className="text-sm text-muted-foreground">{t("allOwned")}</p>}</div>
      {comparison.unknownTraining.length > 0 && <p className="text-xs text-muted-foreground">{t("unknownTraining", { count: comparison.unknownTraining.length })}</p>}
      {comparison.lowerTraining.length > 0 && <ul className="space-y-2 text-sm">{comparison.lowerTraining.map(({ name, actual, expected }) => <li key={name} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2"><span>{name}</span><span>{t("trainingGap", { actualElite: actual.elite, actualLevel: actual.level, expectedElite: expected.elite, expectedLevel: expected.level })}</span></li>)}</ul>}
      {entry.authorBox ? <details className="space-y-3 text-sm"><summary className="cursor-pointer font-medium">{t("fullBoxSummary", { common: comparison.common, author: comparison.authorOnly.length, viewer: comparison.viewerOnly.length })}</summary><p className="break-words leading-6">{t("authorOnly")}{comparison.authorOnly.join("、") || "—"}</p><p className="break-words leading-6">{t("viewerOnly")}{comparison.viewerOnly.join("、") || "—"}</p></details> : <p className="text-xs text-muted-foreground">{t("boxNotShared")}</p>}
    </> : <p className="text-sm text-muted-foreground">{t("matchHint")}</p>}
    <div className="space-y-3"><h4 className="text-sm font-medium">{t("authorBackups")}</h4>{Object.entries(entry.alternatives ?? {}).filter(([, backups]) => backups.length).map(([primary, backups]) => <div key={primary} className="space-y-2 border-t border-border pt-3"><p className="text-sm font-medium">{primary}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant={!choices[primary] ? "secondary" : "outline"} aria-pressed={!choices[primary]} onClick={() => onChoice(primary, "")}>{t("keepPrimary")}</Button>{backups.map(name => <Button key={name} size="sm" variant={choices[primary] === name ? "secondary" : "outline"} aria-pressed={choices[primary] === name} onClick={() => onChoice(primary, name)}>{name}{comparison && !owned.has(operatorKey({ name })) ? ` · ${t("notOwned")}` : ""}</Button>)}</div></div>)}{!Object.values(entry.alternatives ?? {}).some(backups => backups.length) && <p className="text-xs text-muted-foreground">{t("noBackups")}</p>}<p className="text-xs leading-5 text-muted-foreground">{t("replacementWarning")}</p></div>
  </div>;
}
