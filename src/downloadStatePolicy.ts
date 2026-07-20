export type RecoveryLauncherState =
  | "ready"
  | "downloading"
  | "downloaded"
  | "installing"
  | "paused"
  | "checking"
  | "repairPending"
  | "repairing";

export type PersistedRecoveryState = {
  mode?: "install" | "update" | "repair";
  state?: "paused" | "downloaded" | "ready";
};

type InstalledGamePromotionContext = {
  installFilesReady: boolean;
  launcherState: RecoveryLauncherState;
  updateDownloadPending: boolean;
  downloadedBytes: number;
};

export function canPromoteInstalledGame(context: InstalledGamePromotionContext) {
  if (!context.installFilesReady || context.updateDownloadPending || context.downloadedBytes > 0) return false;
  return context.launcherState === "paused" || context.launcherState === "ready";
}

export function isProtectedPersistedOperation(state: PersistedRecoveryState | null | undefined) {
  return state?.mode === "repair" || (state?.mode === "update" && state.state !== "ready");
}

export function shouldPreserveSavedOperation(
  savedState: PersistedRecoveryState | null | undefined,
  diskState: PersistedRecoveryState | null | undefined,
) {
  return isProtectedPersistedOperation(savedState) && !isProtectedPersistedOperation(diskState);
}
