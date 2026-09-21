import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { launcherSource, launcherStyleSource } from "./helpers/launcherSources";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("long-running progress controls", () => {
  it("tracks the source actually used by each game download request", () => {
    const downloadFunction = appSource.slice(
      appSource.indexOf("async function downloadGameArchive()"),
      appSource.indexOf("async function installDownloadedGameArchive()"),
    );

    expect(appSource).toContain("activeGameDownloadSource");
    expect(downloadFunction).toContain("const requestedSource = downloadSource.value");
    expect(downloadFunction).toContain("resolveDownloadArchiveInfo(requestedSource)");
    expect(downloadFunction).toContain("activeGameDownloadSource.value = requestedSource");
    expect(downloadFunction).toContain("if (gameDownloadActive.value) return");
    expect(appSource).toContain("activeGameDownloadSourceName");
    expect(appSource).toContain('gameDownloadActive.value && launcherState.value !== "downloading"');
  });

  it("cancels game downloads and clears only their resumable artifacts", () => {
    const cancelFunction = appSource.slice(
      appSource.indexOf("async function cancelGameDownload()"),
      appSource.indexOf("function requestDeleteGame()"),
    );

    expect(appSource).toContain("canCancelGameDownload");
    expect(cancelFunction).toContain('invoke("pause_game_download")');
    expect(cancelFunction).toContain("waitForGameDownloadToStop");
    expect(cancelFunction).toContain('invoke("clear_game_download_artifacts"');
    expect(cancelFunction).toContain("downloadedBytes.value = 0");
    expect(rustSource).toContain("fn clear_game_download_artifacts(");
    expect(rustSource).toContain('PathBuf::from(&install_path).join("_download")');
    expect(rustSource).toContain("remove_download_artifacts(&download_dir)?");
  });

  it("pauses repair downloads and cancels non-resumable game operations", () => {
    expect(appSource).toContain("repairOperationStage");
    expect(appSource).toContain("pauseRepairDownload");
    expect(appSource).toContain("cancelCurrentGameOperation");
    expect(appSource).toContain('invoke("cancel_game_operation")');
    expect(rustSource).toContain("fn cancel_game_operation()");
  });

  it("pauses and resumes developer game uploads with their original context", () => {
    expect(launcherSource).toContain("developerGamePublishContext");
    expect(launcherSource).toContain("pauseDeveloperUpload");
    expect(launcherSource).toContain("resumeDeveloperUpload");
    expect(launcherSource).toContain('invoke("dev_pause_script")');
    expect(rustSource).toContain("DEV_SCRIPT_PAUSED");
    expect(rustSource).toContain("fn dev_pause_script()");
  });

  it("keeps pause and cancel icons still while showing detailed repair stages", () => {
    expect(appSource).toContain("primaryActionSpinning");
    expect(appSource).toContain("spinning: primaryActionSpinning");
    expect(appSource).toContain('t("status.repairPreparing")');
    expect(appSource).toContain('t("status.repairDownloading")');
    expect(appSource).toContain('t("status.repairWriting")');
    expect(appSource).toContain('t("status.repairVerifying")');
    expect(appSource).toContain("formatBytes(downloadedBytes.value)");
  });

  it("uses the loading icon instead of spinning the gamepad while launching", () => {
    const actionIcon = appSource.slice(
      appSource.indexOf("const actionIcon = computed"),
      appSource.indexOf("const showGameChunkImportAction = computed"),
    );

    expect(actionIcon).toContain("if (gameLaunchPending.value) return RefreshCw");
    expect(actionIcon.indexOf("gameLaunchPending.value")).toBeLessThan(
      actionIcon.indexOf("localGamePlayableWhileNetworkLocked.value"),
    );
  });

  it("shows byte-level manifest verification progress and the current file", () => {
    expect(launcherSource).toContain("currentFile?: string");
    expect(launcherSource).toContain("processedBytes?: number");
    expect(launcherSource).toContain("currentFileTotalBytes?: number");
    expect(appSource).toContain("verificationCurrentFile");
    expect(appSource).toContain("verificationByteProgress");
    expect(rustSource).toContain("current_file: Option<String>");
    expect(rustSource).toContain("processed_bytes: u64");
    expect(rustSource).toContain("calculate_file_sha256_with_progress");
  });

  it("names the resume preparation stages before the first byte moves", () => {
    // 点"继续下载"之后要先拉清单、再把本地文件跟清单逐条对一遍（最慢是整盘哈希，几十秒）。
    // 这期间进度条不动，界面上必须说出来 —— 不然玩家以为卡死了（用户 2026-09-21）。
    expect(appSource).toContain("gamePackagePrepareStage");
    expect(appSource).toContain('gamePackagePrepareStage.value = "获取游戏清单"');
    expect(appSource).toContain('gamePackagePrepareStage.value = "核对下载进度"');

    const statusCopy = appSource.match(/const statusCopy = computed\(\(\) => \{[\s\S]*?\n\}\);/)?.[0];
    expect(statusCopy).toBeTruthy();
    expect(statusCopy).toContain(
      "if (gamePackagePrepareStage.value) return gamePackagePrepareStage.value",
    );
  });

  it("keeps the download dock wide enough for the whole progress line", () => {
    // 进度行有五段（状态 / 字节 / 文件数 / 剩余时间 / 百分比）。310px 放不下时 flex 会把
    // 左边的状态文字挤出容器、再被 overflow:hidden 硬裁掉（半个字，不是省略号）。
    // 宽度对齐三个方块的按钮排：59 + 12 + 189 + 12 + 189 = 461，左端正好和"方形菜单"齐平。
    const dock = launcherStyleSource.match(/\.download-dock\s*\{[\s\S]*?\n\}/)?.[0];
    expect(dock).toBeTruthy();
    expect(dock).toContain("width: 461px;");
    expect(dock).toContain("min-width: 461px;");
  });
});
