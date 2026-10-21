const ignoreCloudWorkspace = () => {};

export function useAccountCloudWorkspace(input: unknown) {
  void input;
  return {
    cloudWorkspaceData: null,
    cloudSyncStatus: "idle" as const,
    applyWorkspace: ignoreCloudWorkspace,
    refreshCloudData: ignoreCloudWorkspace,
    syncElement: null,
  };
}
