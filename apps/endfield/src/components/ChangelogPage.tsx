import { PageTitle, Section } from "@riic/endfield-ui";
import { endfieldChangelog } from "../changelog";
import { pageLabels } from "../page-labels";
import { useWorkspace } from "../state";

export function ChangelogPage() {
  const { t } = useWorkspace();
  return <div className="ef-page ef-document" data-endfield-changelog>
    <PageTitle title={t(...pageLabels["/changelog"])} subtitle={t("帝江号基建终端的功能与体验更新。", "Features and experience updates for the Dijiang infrastructure terminal.")} />
    {endfieldChangelog.map(entry => <Section key={entry.date} title={t(...entry.title)}
      actions={<span className="ef-muted"><time dateTime={entry.date}>{entry.date}</time> · {t("开发预览", "Development preview")}</span>}>
      <ul className="list-disc space-y-3 pl-5 text-sm leading-7 text-muted-foreground">
        {entry.items.map(([zh, en]) => <li key={en}>{t(zh, en)}</li>)}
      </ul>
    </Section>)}
  </div>;
}
