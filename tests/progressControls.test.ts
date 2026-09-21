import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { launcherSource, launcherStyleSource } from "./helpers/launcherSources";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const gamePackageRustSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/game_package.rs"),
  "utf8",
);

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
    // 闸门还开着时**不能**静默 return（那正是用户看到的"点了没反应"）：
    // 现在这里要给出提示，见下面那条 never-swallows-a-click。
    expect(downloadFunction).toContain("if (gameDownloadActive.value) {");
    expect(downloadFunction).not.toContain("if (gameDownloadActive.value) return;");
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

  it("resets the process-wide cancel flag at every download entry point", () => {
    // `DOWNLOAD_CANCELLED` 是**进程级**的：`pause_game_download` 置 true，
    // 每个会跑下载/修复/扫描的命令入口都必须清一次。逐文件链路（`download_game_package`）
    // 以前漏了这一句，于是"暂停过一次之后，这一整个进程里再也继续不了" ——
    // 而且因为前端把 DOWNLOAD_CANCELLED 当"用户主动暂停"，全程静默（用户 2026-09-21）。
    for (const entryPoint of [
      "pub async fn download_game_package(",
      "pub async fn scan_local_game_package(",
      "async fn download_game_archive(",
      "async fn repair_game_from_archive(",
      "async fn verify_game_manifest(",
      "async fn install_downloaded_game_archive(",
    ]) {
      const index = rustSource.indexOf(entryPoint);
      const body =
        index >= 0 ? rustSource.slice(index, index + 900) : gamePackageRustSource.slice(
          gamePackageRustSource.indexOf(entryPoint),
          gamePackageRustSource.indexOf(entryPoint) + 900,
        );
      expect(body, entryPoint).toContain("reset_download_cancelled()");
    }
    expect(rustSource).toContain("pub(crate) fn reset_download_cancelled()");
    // 核对本地文件也要能被暂停打断，否则任务会一直挂在"下载中"，前端那个闸门不放开。
    expect(gamePackageRustSource).toContain("check_download_cancelled()?");
  });

  it("never swallows a click on the primary download button", () => {
    // 项目自己的规矩（见指南 §10.2）：不允许"点一下什么都不发生"。
    // 下载闸门还开着的时候以前是直接 return，用户看到的就是"点了没反应"。
    expect(appSource).not.toContain("if (gameDownloadActive.value) return;");
    expect(appSource).toContain("上一次下载还在收尾");
    // 收尾期间按钮显示"正在停止下载"，但只在 paused / downloaded 两档
    // （install / checking / repairing 有自己的文案，不能被这条盖掉）。
    expect(appSource).toContain('launcherState.value === "paused" || launcherState.value === "downloaded"');
    expect(appSource).toContain('return "正在停止下载";');
  });

  it("continues straight into install and doesn't blame the network while verifying", () => {
    // 用户 2026-09-21 的两条现场反馈：
    // ① 收尾算 sha256 时显示"网络不佳" → 应该说"校验文件"；
    // ② 下完还得再点一次「安装游戏」→ 下完直接接着装。
    expect(appSource).toContain('"game-package-phase"');
    expect(appSource).toContain("gamePackagePhase");
    expect(appSource).toContain('gamePackagePhase.value === "verifying" ? "校验文件" : "网络不佳"');
    expect(rustSource).toContain('"game-package-phase"');
    expect(rustSource).toContain("fn emit_game_package_phase(");
    expect(gamePackageRustSource).toContain('(context.on_phase)("verifying")');
    expect(gamePackageRustSource).toContain('(context.on_phase)("downloading")');

    expect(appSource).toContain("downloadSucceeded = true");
    expect(appSource).toContain("if (downloadSucceeded) {");
    expect(appSource).toContain("await installDownloadedGameArchive()");
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

  it("keeps the resume preparation visibly moving on the right-hand side", () => {
    // 光有"核对下载进度"四个字还是会像卡死：右侧那行得跟着动。
    // 心跳走单独一条事件，绝不动字节进度（动了进度条会先掉到 0 再爬回来）。
    expect(appSource).toContain('"game-package-scan-progress"');
    expect(appSource).toContain("已核对 ");
    expect(launcherSource).toContain("GamePackageScanProgressEvent");
    expect(rustSource).toContain("fn emit_game_package_scan_progress(");
    expect(rustSource).toContain('"game-package-scan-progress"');
    // 逐条哈希的那一层要**每个文件**都报（不是每 N 个报一次，那样小清单只看得到 0/N → N/N），
    // 并且收尾报满（不然界面停在 N-1/N）；顺便带上"已对上的字节"，前端拿它驱动进度条。
    expect(gamePackageRustSource).toContain("on_progress(index as u64, total, matched_files, matched_bytes)");
    expect(gamePackageRustSource).not.toContain("index % 4");
    expect(gamePackageRustSource).toContain("on_progress(total, total, matched_files, matched_bytes)");
    expect(gamePackageRustSource).toContain("crate::emit_game_package_scan_progress");
    expect(rustSource).toContain("matched_bytes: u64");
    expect(appSource).toContain("payload.matchedBytes");
  });

  it("gives the last 10% of the bar to verify + install", () => {
    // 用户 2026-09-21 拍板：前 90% 给"核对 + 下载"，最后 10% 给"校验 + 安装"。
    // 尺子始终是"整包里已经对得上的字节"，所以核对结束正好落在下载起点、下载满格是 90%，
    // 不会再有"下载满格 → 安装又从 0 开始"的断档。
    expect(appSource).toContain("const DOWNLOAD_PROGRESS_SHARE = 90;");
    expect(appSource).toContain(
      "DOWNLOAD_PROGRESS_SHARE + Number((installProgressPercent.value * 0.1).toFixed(2))",
    );
    expect(appSource).toContain(
      "(downloadedMb.value / Math.max(totalMb.value, 0.1)) * DOWNLOAD_PROGRESS_SHARE",
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
