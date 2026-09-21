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

  it("keeps an interrupted download resumable instead of demanding a complete archive", () => {
    // 用户 2026-09-21 报的"退出后再进启动器又要重新下载"：
    // 部分下载（state: "paused"）在磁盘上不可能有完整归档，判据必须和 "downloaded" 分开，
    // 否则重启时这条记录会被判无效、进度被整条清掉。
    const validation = appSource.match(
      /async function validatePersistedDownloadState\(state: PersistedDownloadState\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(validation).toBeTruthy();
    expect(validation).toContain('state.state === "downloaded" ? "downloaded" : "paused"');

    const native = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const nativeValidation = native.match(
      /fn validate_install_state\(install_path: &str, state: &str\)[\s\S]*?\n\}/,
    )?.[0];

    expect(nativeValidation).toBeTruthy();
    // 原生侧对 "paused" 也要早退：它只确认"这单的地盘还在"，
    // 不能落到下面那套"归档/分片必须齐全"的判据上。
    const pausedBranch = nativeValidation!.indexOf('state.eq_ignore_ascii_case("paused")');
    expect(pausedBranch).toBeGreaterThan(-1);
    expect(pausedBranch).toBeLessThan(nativeValidation!.indexOf("archive_has_expected_size"));
  });

  it("keeps resume progress file-based instead of resetting it on every resume", () => {
    // 用户 2026-09-21："不用精准百分比，只要文件对的上就行了"。
    // 逐文件链路的进度事件只报"本轮要下的那些文件"，所以要用文件级基线把进度补回整包坐标，
    // 否则暂停→继续会让进度条和"已完成 N/M 个文件"一起退回 0（看着就是进度被损坏）。
    const download = appSource.match(
      /async function downloadGamePackageFiles\(\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(download).toBeTruthy();
    expect(download).toContain("gamePackageBaseline.value = {");
    expect(download).toContain("downloadedBytes.value = gamePackageBaseline.value.bytes");
    expect(download).not.toContain("downloadedBytes.value = 0;");

    const listener = appSource.match(
      /async function ensureDownloadProgressListener\(\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(listener).toBeTruthy();
    expect(listener).toContain("baseline.bytes + Math.max(0, payload.downloadedBytes || 0)");
    expect(listener).toContain("baseline.files + Math.max(0, payload.doneFiles)");

    // 主按钮的文案和分流不再看字节数：暂停/继续会把本轮字节清零，`.part` 阶段更是 0，
    // 那时"继续下载"会莫名其妙退化成"选安装路径"。
    expect(appSource).toContain("installPathHasPartialWork");
    expect(appSource).not.toContain("if (downloadedMb.value <= 0) {");
    expect(appSource).not.toContain('return downloadedMb.value > 0 ? t("action.resumeDownload")');
    expect(appSource).toContain('if (!installPathHasPartialWork.value) {');
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
