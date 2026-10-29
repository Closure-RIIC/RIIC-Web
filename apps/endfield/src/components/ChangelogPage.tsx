import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Action, PageTitle, Section, Notice } from "@riic/endfield-ui";
import type { ReleaseFeed } from "@riic/arknights-domain/releases/types";
import { useAccount } from "../account";
import { requestReleases } from "../releases";
import { ReleaseEntry } from "./ReleaseEntry";
import { endfieldChangelog } from "../changelog";
import { pageLabels } from "../page-labels";
import { useWorkspace } from "../state";

export function ChangelogPage() {
  const { locale, t } = useWorkspace();
  const { isAdmin } = useAccount();
  const [feed, setFeed] = useState<ReleaseFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestReleases<ReleaseFeed>("/api/endfield/releases", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setFeed(value); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  return <div className="ef-page ef-document" data-endfield-changelog>
    <PageTitle title={t(pageLabels["/changelog"])} subtitle={t("Changelog.featuresAndExperienceUpdatesForTheDijiangInfrastructureTerminal")}
      action={isAdmin ? <Link to="/admin/changelog" className="text-sm underline">{t("Navigation.changelogAdmin")}</Link> : undefined} />
    {failed ? <Notice error>{t("Changelog.loadFailed")} <Action size="sm" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t("Changelog.retry")}</Action></Notice>
      : !feed ? <Notice>{t("Changelog.loading")}</Notice> : null}
    {feed?.releases.map(release => <ReleaseEntry key={release.version} release={release} locale={locale} />)}
    {endfieldChangelog.map(entry => <Section key={entry.date} title={t(entry.title)}
      actions={<span className="ef-muted"><time dateTime={entry.date}>{entry.date}</time> · {t("Changelog.developmentPreview")}</span>}>
      <ul className="list-disc space-y-3 pl-5 text-sm leading-7 text-muted-foreground">
        {entry.items.map(key => <li key={key}>{t(key)}</li>)}
      </ul>
    </Section>)}
  </div>;
}
