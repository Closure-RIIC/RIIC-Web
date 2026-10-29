"use client";

import { releaseText } from "@riic/arknights-domain/releases/types";
import { Badge } from "@/components/ui/badge";
import { useLocale, useTranslations } from "use-intl";
import type { ReleaseNote } from "@riic/arknights-domain/releases/types";

const SECTION_KEYS = { added: "new", improved: "improved", fixed: "fixed" } as const;

/** Shared by the public release history and the what's-new dialog. */
export function ReleaseNotes({ release }: { release: ReleaseNote }) {
  const t = useTranslations("ReleaseNotes");
  const locale = useLocale();
  return (
    <div className="grid gap-6" data-release-notes={release.version}>
      {release.sections.map((section) => (
        <section key={section.kind} className="grid gap-2.5">
          <h3><Badge variant="outline">{t(SECTION_KEYS[section.kind])}</Badge></h3>
          <ul className="list-disc space-y-2.5 pl-4 text-sm leading-7 marker:text-muted-foreground">
            {section.items.map((item, index) => <li key={index} className="pl-1 whitespace-pre-wrap break-words">{releaseText(item, locale)}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
