"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { PRESETS } from "@/blueprint";
import type { CloudSyncStatus } from "@/cloud-sync";
import { normalizeOperboxEntries } from "@/operbox-normalization";
import type {
  BaseBlueprint,
  BoxSource,
  CloudWorkspaceData,
  OperBoxEntry,
  PresetDef,
  PublicPlanData,
  RotationProfile,
} from "@/types";
import { CloudDataSync } from "./CloudDataSync";

export interface AccountCloudWorkspaceInput {
  userId: string | null;
  hasRestoredSession: boolean;
  hasLocalSession: boolean;
  preset: PresetDef;
  setPreset: Dispatch<SetStateAction<PresetDef>>;
  layout: BaseBlueprint;
  setLayout: Dispatch<SetStateAction<BaseBlueprint>>;
  operbox: OperBoxEntry[] | null;
  setOperbox: Dispatch<SetStateAction<OperBoxEntry[] | null>>;
  fileName: string | null;
  setFileName: Dispatch<SetStateAction<string | null>>;
  boxSource: BoxSource;
  setBoxSource: Dispatch<SetStateAction<BoxSource>>;
  layoutDirty: boolean;
  setLayoutDirty: Dispatch<SetStateAction<boolean>>;
  layoutSource: "local" | "skland";
  setLayoutSource: Dispatch<SetStateAction<"local" | "skland">>;
  localLayoutBackup: BaseBlueprint | null;
  setLocalLayoutBackup: Dispatch<SetStateAction<BaseBlueprint | null>>;
  rotationProfile: RotationProfile;
  setRotationProfile: Dispatch<SetStateAction<RotationProfile>>;
  fiammettaEnabled: boolean;
  setFiammettaEnabled: Dispatch<SetStateAction<boolean>>;
  result: PublicPlanData | null;
  setResult: Dispatch<SetStateAction<PublicPlanData | null>>;
  activeShift: number;
  setActiveShift: Dispatch<SetStateAction<number>>;
}

export function useAccountCloudWorkspace(value: AccountCloudWorkspaceInput | null) {
  // The client flag and the Turbopack alias use the same build-time environment value.
  // This implementation is therefore selected only when the input is present.
  const input = value as AccountCloudWorkspaceInput;
  const {
    setActiveShift,
    setBoxSource,
    setFiammettaEnabled,
    setFileName,
    setLayout,
    setLayoutDirty,
    setLayoutSource,
    setLocalLayoutBackup,
    setOperbox,
    setPreset,
    setResult,
    setRotationProfile,
  } = input;
  const [cloudWorkspaceData, setCloudWorkspaceData] = useState<CloudWorkspaceData | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>("idle");
  const [refreshKey, setRefreshKey] = useState(0);
  const workspace = useMemo(() => ({
    state: {
      presetLabel: input.preset.label,
      layout: input.layout,
      sourceName: input.fileName,
      boxSource: input.boxSource,
      layoutDirty: input.layoutDirty,
      layoutSource: input.layoutSource,
      localLayoutBackup: input.localLayoutBackup,
      rotationProfile: input.rotationProfile,
      fiammettaEnabled: input.fiammettaEnabled,
      activeShift: input.activeShift,
    },
    operbox: input.boxSource === "maa" ? input.operbox : null,
    result: input.boxSource === "maa" ? input.result : null,
  }), [input.activeShift, input.boxSource, input.fiammettaEnabled, input.fileName, input.layout, input.layoutDirty, input.layoutSource, input.localLayoutBackup, input.operbox, input.preset.label, input.result, input.rotationProfile]);

  const applyWorkspace = useCallback((cloud: CloudWorkspaceData) => {
    if (!cloud.exists || !cloud.state) return;
    const state = cloud.state;
    setPreset(PRESETS.find((item) => item.label === state.presetLabel) ?? PRESETS[0]);
    setLayout(structuredClone(state.layout));
    setOperbox(cloud.operbox ? normalizeOperboxEntries(cloud.operbox) : null);
    setFileName(state.sourceName);
    setBoxSource(state.boxSource);
    setLayoutDirty(state.layoutDirty);
    setLayoutSource(state.layoutSource);
    setLocalLayoutBackup(state.localLayoutBackup ? structuredClone(state.localLayoutBackup) : null);
    setRotationProfile(state.rotationProfile);
    setFiammettaEnabled(state.fiammettaEnabled);
    setResult(cloud.result);
    setActiveShift(cloud.result ? state.activeShift : 0);
    setCloudWorkspaceData(cloud);
  }, [
    setActiveShift,
    setBoxSource,
    setFiammettaEnabled,
    setFileName,
    setLayout,
    setLayoutDirty,
    setLayoutSource,
    setLocalLayoutBackup,
    setOperbox,
    setPreset,
    setResult,
    setRotationProfile,
  ]);

  const handleWorkspaceChanged = useCallback((cloud: CloudWorkspaceData | null) => {
    setCloudWorkspaceData(cloud);
  }, []);

  return {
    cloudWorkspaceData,
    cloudSyncStatus,
    applyWorkspace,
    refreshCloudData: () => setRefreshKey((current) => current + 1),
    syncElement: input.hasRestoredSession ? (
      <CloudDataSync
        key={input.userId ?? "anonymous"}
        userId={input.userId}
        hasLocalSession={input.hasLocalSession}
        workspace={workspace}
        refreshKey={refreshKey}
        onApply={applyWorkspace}
        onWorkspaceChanged={handleWorkspaceChanged}
        onStatusChanged={setCloudSyncStatus}
      />
    ) : null,
  };
}
