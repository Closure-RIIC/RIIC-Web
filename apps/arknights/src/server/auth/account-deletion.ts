type AccountPrivateArtifactCleanupDependencies = {
  references: (userId: string) => Promise<{ diagnosticIds: string[]; feedbackIds: string[] }>;
  deleteFeedback: (feedbackIds: string[]) => Promise<number>;
  deleteRuns: (diagnosticIds: string[]) => Promise<number>;
};

const defaultDependencies: AccountPrivateArtifactCleanupDependencies = {
  references: async (userId) => (await import("@/server/business-records")).accountPrivateArtifactReferences(userId),
  deleteFeedback: async (feedbackIds) => (await import("@/server/infra")).deleteFeedbackArtifacts(feedbackIds),
  deleteRuns: async (diagnosticIds) => (await import("@/server/infra")).deletePlanRunArtifacts(diagnosticIds),
};

export async function deleteWebsiteAccountPrivateArtifacts(
  userId: string,
  dependencies = defaultDependencies,
): Promise<void> {
  const artifacts = await dependencies.references(userId);
  await dependencies.deleteFeedback(artifacts.feedbackIds);
  await dependencies.deleteRuns(artifacts.diagnosticIds);
}
