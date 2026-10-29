import { Section } from "@riic/endfield-ui";
import { releaseText, type ReleaseNote } from "@riic/arknights-domain/releases/types";
import type { AppLocale } from "@riic/contracts/locale";
import { useWorkspace } from "../state";

export const releaseKindLabels = { added: "Changelog.added", improved: "Changelog.improved", fixed: "Changelog.fixed" } as const;

export function ReleaseEntry({ release, locale }: { release: ReleaseNote; locale: AppLocale }) {
  const { t } = useWorkspace();
  return <Section title={releaseText(release.title, locale)} actions={<span className="ef-muted">v{release.version} · <time dateTime={release.date}>{release.date}</time></span>}>
    {release.sections.map(section => <div key={section.kind} className="my-4">
      <h3 className="mb-2 text-sm font-semibold">{t(releaseKindLabels[section.kind])}</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
        {section.items.map((item, index) => <li className="whitespace-pre-wrap break-words" key={index}>{releaseText(item, locale)}</li>)}
      </ul>
    </div>)}
  </Section>;
}
