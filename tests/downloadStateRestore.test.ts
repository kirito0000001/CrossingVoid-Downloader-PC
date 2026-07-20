import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("launcher download state restoration", () => {
  it("restores the current install path from disk before validating stale local state", () => {
    const diskRestoreIndex = appSource.indexOf("await restoreDownloadStateFromDisk()");
    const staleValidationIndex = appSource.indexOf("await validateCurrentPersistedState()", diskRestoreIndex);

    expect(diskRestoreIndex).toBeGreaterThan(-1);
    expect(staleValidationIndex).toBeGreaterThan(diskRestoreIndex);
    expect(appSource).toContain("installPath: installPath.value");
    expect(appSource).not.toContain("installPath: DEFAULT_GAME_INSTALL_PATH");
  });

  it("does not replace an active update, repair, or partial download with the old installed game", () => {
    const functionSource = appSource.match(
      /async function restoreReadyInstallFromFiles\(\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(functionSource).toBeTruthy();
    expect(functionSource).toContain("canPromoteInstalledGame");
    expect(appSource).toContain("updateDownloadPending: updateDownloadPending.value");
    expect(appSource).toContain("downloadedBytes: downloadedBytes.value");
    expect(appSource).toContain("launcherState: launcherState.value");
  });

  it("clears stale download context only when restoring an idle complete install", () => {
    const functionSource = appSource.match(
      /async function restoreReadyInstallFromFiles\(\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(functionSource).toBeTruthy();
    expect(functionSource).toContain('state: "ready"');
    expect(functionSource).toContain('mode: "install"');
    expect(functionSource).toContain("downloadedBytes: 0");
    expect(functionSource).toContain("updateDownloadPending.value = false");
    expect(functionSource).toContain("pendingRepairSummary.value = null");
  });

  it("rechecks externally restored files when the launcher regains focus", () => {
    expect(appSource).toContain("onFocusChanged");
    expect(appSource).toContain("refreshExternalInstallState");
  });

  it("persists ready state after a successful repair and verifies the result", () => {
    const repairSource = appSource.match(/async function repairMissingGameFiles\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(repairSource).toBeTruthy();
    expect(repairSource).toContain('invoke<ManifestVerifySummary>("verify_game_manifest"');
    expect(repairSource).toContain('persistDownloadState("ready", "immediate")');
  });

  it("checks local game files before network and automatic repair work when launching", () => {
    const launchSource = appSource.match(/async function launchInstalledGame\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(launchSource).toBeTruthy();
    const localCheckIndex = launchSource!.indexOf("ensureInstalledGameExistsBeforeLaunch");
    const versionCheckIndex = launchSource!.indexOf("ensureFreshVersionBeforeLaunch");
    const autoRepairIndex = launchSource!.indexOf("ensureAutomaticRepairBeforeLaunch");
    expect(localCheckIndex).toBeGreaterThan(-1);
    expect(versionCheckIndex).toBeGreaterThan(localCheckIndex);
    expect(autoRepairIndex).toBeGreaterThan(versionCheckIndex);
    expect(appSource).toContain("markUnavailableInstalledGame");
    expect(appSource).toContain("未找到游戏文件，已切换为下载游戏");
    expect(appSource).toContain("检测到部分游戏文件缺失，请使用修复文件补齐");
  });
});
