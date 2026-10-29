import { PageTitle, Section } from "@riic/endfield-ui";
import { Link } from "@tanstack/react-router";
import { useWorkspace } from "../state";
import { RosterDialogTrigger } from "./RosterDialog";
export function DocsPage() {
  const { t } = useWorkspace();
  return <div className="ef-page ef-document"><PageTitle title={t("Docs.endfieldDocs")} subtitle={t("Docs.fromYourRosterToTheNextShift")} />
    <Section title={t("Docs.yourFirstSchedule")}><p>{t("Docs.useEditRosterToFilterAndSelectYourOperators")}</p><p>{t("Docs.sklandSyncUpdatesFacilityLevelsAutomaticallyYouCanAlso")}</p><p><RosterDialogTrigger className="ef-text-action">{t("Docs.setUpYourRoster")}</RosterDialogTrigger></p></Section>
    <Section title={t("Docs.readingResults")}><p>{t("Docs.theFacilityOverviewShowsBothShiftsAndTheirTimes")}</p><p>{t("Docs.outputIsExpressedAsEffectiveHoursPerDayNot")}</p></Section>
    <Section title={t("Docs.sklandSync")}>
      <p>{t("Docs.openSklandSyncAndSignInWithQrOr")}</p>
      <p>{t("Docs.syncUpdatesOperatorsEliteStagesAndValidFacilityLevels")}</p>
      <p><Link to="/skland">{t("Docs.openSklandSync")}</Link></p>
    </Section>
    <Section title={t("Docs.faq")}>
      <details><summary>{t("Docs.willSwitchingGamesEraseMyRoster")}</summary><p>{t("Docs.eachGameKeepsSeparateLocalDraftsThisEndfieldRoster")}</p></details>
      <details><summary>{t("Docs.whyWasNoResultGenerated")}</summary><p>{t("Docs.checkThatYouHaveEnoughOperatorsForBothShifts")}</p></details>
      <details><summary>{t("Docs.canIImportAnArknightsFile")}</summary><p>{t("Docs.noSelectEndfieldOperatorsInEditRosterSklandSync")}</p></details>
    </Section>
  </div>;
}
