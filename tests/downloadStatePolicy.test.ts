import { describe, expect, it } from "vitest";
import {
  canPromoteInstalledGame,
  shouldPreserveSavedOperation,
} from "../src/downloadStatePolicy";

describe("installed game promotion policy", () => {
  const idleInstall = {
    installFilesReady: true,
    launcherState: "paused" as const,
    updateDownloadPending: false,
    downloadedBytes: 0,
  };

  it("accepts an externally restored complete game while idle", () => {
    expect(canPromoteInstalledGame(idleInstall)).toBe(true);
  });

  it("preserves an update download even when the old game remains launchable", () => {
    expect(canPromoteInstalledGame({ ...idleInstall, updateDownloadPending: true })).toBe(false);
  });

  it("preserves repair and partial download states", () => {
    expect(canPromoteInstalledGame({ ...idleInstall, launcherState: "repairPending" })).toBe(false);
    expect(canPromoteInstalledGame({ ...idleInstall, downloadedBytes: 1 })).toBe(false);
    expect(canPromoteInstalledGame({ ...idleInstall, launcherState: "downloaded" })).toBe(false);
  });

  it("does not let a stale disk ready marker replace a saved update or repair task", () => {
    const diskReady = { mode: "install" as const, state: "ready" as const };
    expect(shouldPreserveSavedOperation({ mode: "update", state: "paused" }, diskReady)).toBe(true);
    expect(shouldPreserveSavedOperation({ mode: "repair", state: "paused" }, diskReady)).toBe(true);
    expect(shouldPreserveSavedOperation(diskReady, { mode: "repair", state: "paused" })).toBe(false);
  });
});
