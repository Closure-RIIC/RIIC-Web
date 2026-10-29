import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type Docs from "../../messages/zh-CN/Docs.json";
import type Knowledge from "../../messages/zh-CN/help_knowledge.json";
const docsText = createLocalizer<typeof Docs>("Docs");
import { helpKnowledgeText } from "../i18n/helpers/help_knowledge.ts";

export type DocText = keyof typeof Docs | `help:${keyof typeof Knowledge}`;
export const docText = (value: DocText, locale: AppLocale) => value.startsWith("help:") ? helpKnowledgeText.text(locale, value.slice(5) as keyof typeof Knowledge) : docsText.text(locale, value as keyof typeof Docs);
export type DocGroup = "start" | "scheduling" | "features" | "faq" | "account";
export interface DocSection {
  id: string;
  title: DocText;
  paragraphs?: DocText[];
  steps?: DocText[];
}
export interface DocArticle {
  slug: string;
  group: DocGroup;
  title: DocText;
  description: DocText;
  sections: DocSection[];
  related?: string[];
  action?: { href: string; label: DocText };
  kind?: "import" | "videos" | "faq";
  knowledgeId?: "maa" | "box" | "filler" | "shifts" | "drones" | "fiammetta" | "dorm" | "busy";
}

export const DOC_GROUPS: { id: DocGroup; title: DocText; description: DocText }[] = [
  { id: "start", title: "gettingStarted", description: "fromImportingOperatorsToYourFirstBaseSchedule" },
  { id: "scheduling", title: "schedulingBase", description: "understandRotationsAndAdaptYourBasePlan" },
  { id: "features", title: "featureGuides", description: "exploreAccountHealthTrainingPlansAndTheAssistant" },
  { id: "faq", title: "troubleshooting", description: "findAnAnswerStartingWithTheProblemYouSee" },
  { id: "account", title: "accountSettings", description: "manageSignInDevicesDataAndCredits" },
];

const knowledge = (id: NonNullable<DocArticle["knowledgeId"]>, slug: string, group: DocGroup, title: DocText, related: string[]): DocArticle => ({
  slug, group, title, related, knowledgeId: id,
  description: `help:${id}Question`,
  sections: [{ id: "answer", title: "explanationNextSteps", paragraphs: [`help:${id}Answer`] }],
});

export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: "first-import", group: "start", kind: "import", title: "yourFirstImport",
    description: "importYourOwnOperatorsBeforeCreatingABaseSchedule",
    sections: [
      { id: "open-settings", title: "openSetup" },
      { id: "change-box", title: "replaceTheOperatorBox" },
      { id: "choose-source-in-app", title: "chooseADataSource" },
      { id: "import-methods", title: "importWithSklandOrMaa" },
      { id: "finish", title: "saveAndGenerate" },
    ], related: ["first-schedule", "export-maa", "faq-box"],
  },
  {
    slug: "skland-sync", group: "start", title: "sklandSync",
    description: "readYourOperatorsAndBaseDataThroughSkland",
    sections: [
      { id: "connect", title: "connectACharacter", steps: ["openSklandSyncAndChooseQrLoginOrCredential", "confirmTheAgreementsAndAuthorizationThenSelectTheGame", "waitForSyncToFinishAndCheckTheCharacter"] },
      { id: "apply", title: "useTheDataForScheduling", paragraphs: ["inBoxLayoutSetupChooseSklandAndApplyIts"] },
      { id: "refresh", title: "refreshingExpiredAuthorization", paragraphs: ["syncAgainAfterYourCharacterDataChangesIfAuthorization"] },
    ], related: ["first-import", "faq-sync"], action: { href: "/skland", label: "openSklandSync" },
  },
  {
    slug: "maa-import", group: "start", title: "importFromMaa",
    description: "importTheOperatorsYouOwnAndTheirLevelsFrom",
    sections: [
      { id: "export", title: "prepareAnOperatorFile", paragraphs: ["recognizeAndExportYourOperatorsInMaaThenLocate"] },
      { id: "upload", title: "importAndSave", steps: ["openBoxLayoutSetupAndSelectTheOperatorData", "chooseMaaThenUploadTheFileOrPasteThe", "checkTheOperatorCountAndLevelsFinishTheLayout", "generateANewScheduleToUseTheImportedBox"] },
    ], related: ["first-import", "first-schedule", "video-tutorials"],
  },
  {
    slug: "first-schedule", group: "start", title: "createYourFirstSchedule",
    description: "checkYourOperatorsLayoutAndRotationBeforeReviewingEach",
    sections: [
      { id: "prepare", title: "beforeYouGenerate", steps: ["useYourOwnOperatorBoxRatherThanTheAll", "verifyFactoryTradingPostPowerPlantAndDormitoryCounts", "chooseARotationThatFitsYourPlayScheduleAnd"] },
      { id: "generate", title: "generateAndReview", paragraphs: ["submitOneGenerationRequestAndWaitForItTo", "changingTheBoxLayoutOrOptionsDoesNotRecalculate"] },
    ], action: { href: "/", label: "openAutomaticScheduling" }, related: ["export-maa", "manual-schedule", "shifts"],
  },
  knowledge("maa", "export-maa", "start", "exportToMaa", ["first-schedule", "dormitories", "video-tutorials"]),
  { slug: "video-tutorials", group: "start", kind: "videos", title: "videoTutorials", description: "watchOperatorImportsMaaExportsManualSchedulingAndShift", sections: [{ id: "videos", title: "tutorials" }], related: ["first-import", "manual-schedule"] },
  {
    slug: "manual-schedule", group: "scheduling", title: "manualScheduling",
    description: "adjustRoomsAndShiftsThenReviewTheResultBefore",
    sections: [
      { id: "edit", title: "editASchedule", steps: ["openManualSchedulingAndSelectTheShiftAndRoom", "chooseOperatorsFromYourBoxAndCheckForConflicting", "adjustRoomProductsRotationsAndDroneTargetsAsNeeded"] },
      { id: "review", title: "evaluateAndExport", paragraphs: ["reviewTheEvaluationAndMoraleChangesAfterEditingCheck"] },
    ], related: ["shifts", "drones", "export-maa"], action: { href: "/manual", label: "openManualScheduling" },
  },
  knowledge("shifts", "shifts", "scheduling", "shiftsRotations", ["first-schedule", "manual-schedule"]),
  knowledge("drones", "drones", "scheduling", "droneAllocation", ["manual-schedule", "export-maa"]),
  knowledge("fiammetta", "fiammetta", "scheduling", "fiammetta", ["shifts", "first-schedule"]),
  knowledge("dorm", "dormitories", "scheduling", "dormitoriesExecutionOrder", ["export-maa", "manual-schedule"]),
  {
    slug: "operators", group: "features", title: "charactersOperators", description: "checkYourActiveCharacterAndUnderstandHowOperatorData",
    sections: [{ id: "source", title: "checkTheSource", paragraphs: ["schedulingUsesTheBoxInYourCurrentConfigurationAfter"] }, { id: "levels", title: "changesInOperatorLevels", paragraphs: ["promotionAndOtherLevelChangesCanAffectAvailableBase"] }], related: ["skland-sync", "maa-import", "faq-box"],
  },
  {
    slug: "account-health", group: "features", title: "accountHealth", description: "reviewBaseRecommendationsUsingYourOperatorsInventoryAndPreferences",
    sections: [{ id: "data", title: "checkYourDataFirst", paragraphs: ["checkTheActiveCharacterAndDataSourceSyncMissing"] }, { id: "preferences", title: "setYourPreferences", paragraphs: ["fillInPreferencesYouHaveAlreadySettledOnLeave"] }], action: { href: "/account-health", label: "openAccountHealth" }, related: ["training-plan", "skland-sync"],
  },
  {
    slug: "training-plan", group: "features", title: "trainingPlans", description: "setTargetLevelsAndReviewMaterialGapsCraftingLmd",
    sections: [{ id: "goals", title: "setYourGoals", steps: ["selectOperatorsAndCheckTheirCurrentPromotionLevelSkills", "setTargetLevelsAndMakeSureTheInventoryBelongs"] }, { id: "gaps", title: "readTheGaps", paragraphs: ["reviewMaterialGapsAfterInventoryAndTheCraftingPlan"] }], related: ["account-health", "skland-sync"], action: { href: "/training-plan", label: "openTrainingPlans" },
  },
  {
    slug: "gacha-analysis", group: "features", title: "headhuntingAnalysis", description: "importHeadhuntingRecordsAndReviewThemByBanner",
    sections: [{ id: "import", title: "importRecords", paragraphs: ["openHeadhuntingAnalysisAndUseTheAvailableSignIn"] }, { id: "coverage", title: "checkTheCoverage", paragraphs: ["statisticsUseTheRecordsYouHaveImportedCheckThe"] }], action: { href: "/gacha", label: "openHeadhuntingAnalysis" }, related: ["account-data"],
  },
  {
    slug: "assistant", group: "features", title: "closureAssistant", description: "askFromYourCurrentPageOrOpenTheFull",
    sections: [{ id: "context", title: "askAboutTheCurrentPage", paragraphs: ["openTheFloatingAssistantAndReviewTheSharedPage"] }, { id: "history", title: "newChatsHistory", paragraphs: ["reloadingStartsAFreshActiveChatSavedConversationsRemain"] }, { id: "access", title: "availability", paragraphs: ["assistantAccessDependsOnYourAccountPermissionsAndFeature"] }], related: ["credits", "account-login"],
  },
  { slug: "faq", group: "faq", kind: "faq", title: "commonQuestions", description: "findTheSymptomYouSeeThenFollowTheCorresponding", sections: [{ id: "questions", title: "questions" }], related: ["first-import"] },
  knowledge("box", "faq-box", "faq", "unownedOperatorsInResults", ["first-import", "maa-import", "skland-sync"]),
  {
    slug: "faq-box-not-applied", group: "faq", title: "resultsUnchangedAfterImport", description: "existingResultsDoNotAutomaticallyUpdateAfterImportingNew",
    sections: [{ id: "resolve", title: "applyAndGenerateAgain", steps: ["openSetupAndCheckThatTheSourceIsYour", "saveWithFinishThenReturnToAutomaticSchedulingAnd", "ifResultsStillDifferCheckTheCharacterServerAnd"] }], related: ["faq-box", "first-schedule"],
  },
  {
    slug: "faq-saved-box", group: "faq", title: "setupStartsAtStep2", description: "withASavedBoxSetupCanContinueDirectlyTo",
    sections: [{ id: "resolve", title: "returnToOperatorData", paragraphs: ["selectStep1OperatorDataAtTheTopOf"] }], related: ["first-import", "faq-box-not-applied"],
  },
  knowledge("filler", "faq-filler", "faq", "operatorsWithoutMatchingSkills", ["first-schedule", "manual-schedule"]),
  knowledge("busy", "faq-busy", "faq", "busyRequestsOrFailedSolves", ["first-schedule", "account-login"]),
  {
    slug: "faq-sync", group: "faq", title: "sklandSyncFails", description: "checkAuthorizationCharacterSelectionAndTheLastDataUpdate",
    sections: [{ id: "resolve", title: "troubleshootingSteps", steps: ["readTheMessageSignInToTheWebsiteIf", "checkTheCharacterAndServerThenSyncOnceMore", "waitWhenRateLimitedInsteadOfSubmittingRepeatedly"] }, { id: "report", title: "ifItStillFails", paragraphs: ["includeTheTimeErrorRequestIdAndFailingStep"] }], related: ["skland-sync", "faq-busy"],
  },
  {
    slug: "account-login", group: "account", title: "signInDevices", description: "manageWebsiteSessionsSeparatelyFromGameCharacterAuthorization",
    sections: [{ id: "sign-in", title: "signInToTheWebsite", paragraphs: ["useTheAccountControlAtTheBottomOfThe"] }, { id: "devices", title: "reviewSignedInDevices", paragraphs: ["manageYourProfileAndSignedInDevicesInSettings"] }], related: ["account-data", "skland-sync"], action: { href: "/settings", label: "openSettings" },
  },
  {
    slug: "account-data", group: "account", title: "savedDataSettings", description: "understandLocalDataAndAccountFeaturesBeforeClearingConfigurations",
    sections: [{ id: "local", title: "dataInYourBrowser", paragraphs: ["importedConfigurationsAndPreferencesAreStoredInTheCurrent"] }, { id: "cloud", title: "cloudDataDeletion", paragraphs: ["cloudFeaturesDependOnWhatThePageOffersAnd"] }, { id: "preferences", title: "interfacePreferences", paragraphs: ["manageDisplayAndResourceLoadingOptionsInSettingsLanguage"] }], related: ["account-login"], action: { href: "/settings", label: "openSettings" },
  },
  {
    slug: "credits", group: "account", title: "creditsPaymentPlans", description: "reviewAccountCreditsAndAvailablePaymentPlans",
    sections: [{ id: "plans", title: "viewPlansBalance", paragraphs: ["afterSigningInOpenPaymentPlansFromTheAccount"] }, { id: "balance", title: "whenCreditsAreInsufficient", paragraphs: ["checkTheSignedInAccountBalanceAndOrderStatus"] }], related: ["assistant", "account-login"],
  },
];

export const findDoc = (slug: string) => DOC_ARTICLES.find(article => article.slug === slug);

/** Search the small public document catalogue, without loading application data. */
export function searchDocs(query: string, locale: AppLocale) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return DOC_ARTICLES.slice(0, 6);
  return DOC_ARTICLES.map(article => {
    const title = docText(article.title, locale).toLocaleLowerCase();
    const body = [article.slug, docText(article.description, locale), ...article.sections.flatMap(section => [section.title, ...(section.paragraphs ?? []), ...(section.steps ?? [])].map(value => docText(value, locale)))].join(" ").toLocaleLowerCase();
    const score = terms.every(term => title.includes(term) || body.includes(term))
      ? terms.reduce((sum, term) => sum + (docText(article.title, locale).toLocaleLowerCase().includes(term) ? 8 : title.includes(term) ? 4 : 1), 0) : 0;
    return { article, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.article);
}
