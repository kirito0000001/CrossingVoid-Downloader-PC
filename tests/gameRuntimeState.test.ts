import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const packageSource = readFileSync(resolve(process.cwd(), "src-tauri/src/game_package.rs"), "utf8");

/**
 * 切档必须**原地换状态**，不能重载窗口。
 *
 * 2026-09-22 用户报的现象：「最初加载的时候资源就都加载好了，怎么切换游戏还要加载一遍」——
 * 起因是第一版切档直接 `window.location.reload()`，整个 WebView 重来、连开机动画都再放一次。
 * 现在改成 `applyGameScopedState(gameId)` 把这一档的状态铺回去，只重查这一档的版本/运行状态。
 */
describe("game runtime state switching", () => {
  it("切换档位不重载窗口", () => {
    expect(appSource).not.toContain("window.location.reload()");
    expect(appSource).toContain("applyGameScopedState(id)");
    expect(appSource).toContain("await refreshActiveGamePage()");
  });

  it("档位状态复位覆盖所有跟档位绑定的状态", () => {
    const block = appSource.slice(
      appSource.indexOf("function applyGameScopedState("),
      appSource.indexOf("async function refreshActiveGamePage()"),
    );
    expect(block.length).toBeGreaterThan(200);

    // 安装位置 / 存档 / 下载进度 / 版本 / 运行状态，一个都不能漏：
    // 漏一个就会把上一档的数字带到下一档页面上。
    for (const field of [
      "savedDownloadState = state",
      "launcherState.value =",
      "installPath.value =",
      "selectedInstallBasePath.value =",
      "downloadedBytes.value =",
      "activeDownloadBytes.value =",
      "activeGameDownloadSource.value =",
      "installPathHasPartialWork.value =",
      "pendingRepairSummary.value =",
      "updateDownloadPending.value =",
      "installStage.value =",
      "localGameVersion.value =",
      "remoteGameVersion.value =",
      "updateAvailable.value =",
      "gameRunning.value = false",
      "restoredDiskDownloadState = false",
    ]) {
      expect(block, `applyGameScopedState 漏了 ${field}`).toContain(field);
    }
  });

  it("读存档的状态变量必须是可重新赋值的", () => {
    // 切换档位要重新读另一档的 localStorage 存档，const 做不到。
    expect(appSource).toContain("let savedDownloadState = readPersistedDownloadState(");
  });

  it("切档只重查这一档，不重放启动时那套共享加载", () => {
    const block = appSource.slice(
      appSource.indexOf("async function refreshActiveGamePage()"),
      appSource.indexOf("async function selectPlatformGame("),
    );
    // 启动器级的东西（流量额度 / 启动器更新）启动时已经拿过，切档不再重复拉。
    expect(block).not.toContain("refreshTrafficQuota()");
    expect(block).not.toContain("checkLauncherUpdate(");
    // 公告和渠道开关是**按档位**的，切档必须重新拉这一档的。
    expect(block).toContain("refreshRemoteLauncherNotice()");
    expect(block).toContain("refreshRemoteDownloadChannels()");
    // 但这一档自己的安装状态、版本、运行状态必须重查。
    expect(block).toContain("restoreReadyInstallFromFiles()");
    expect(block).toContain("readLocalGameVersion()");
    expect(block).toContain("refreshGameRunningState()");
    expect(block).toContain("checkGameVersion({ manual: false })");
  });

  it("切档不打断下载：先留快照，进度按安装目录归位", () => {
    const switchBlock = appSource.slice(
      appSource.indexOf("async function selectPlatformGame("),
      appSource.indexOf("function openPlatformGameOverview()"),
    );
    // 以前切档会弹"会中断下载"的确认；现在下载照跑，不该再有这道拦截。
    expect(switchBlock).not.toContain("ask(");
    expect(switchBlock).toContain("captureGameRuntime(activeGameId.value)");

    // 事件必须能归到具体游戏，否则切档后 A 的进度会写进 B 的存档（串档）。
    expect(appSource).toContain("function gameIdForInstallPath(");
    expect(appSource).toContain("function patchSnapshotProgress(");
    expect(appSource).toContain("const eventGameId = gameIdForInstallPath(");

    // Rust 侧三条进度事件都要带安装目录。
    expect(rustSource).toContain("install_path: String");
    expect(rustSource).toContain("fn emit_game_package_progress(\n    app: &AppHandle,\n    install_path: &str,");
    expect(packageSource).toContain("&progress_install_path");
    expect(packageSource).toContain("&phase_install_path");
  });

  it("暂停只停当前档位，别的档位有自己的取消标志", () => {
    const taskSource = readFileSync(
      resolve(process.cwd(), "src-tauri/src/download_task.rs"),
      "utf8",
    );
    // 每档一个标志 + 线程局部定位当前任务；没进作用域的线程才退回全局标志。
    expect(taskSource).toContain("static TASKS: Mutex<Vec<(String, Arc<AtomicBool>)>>");
    expect(taskSource).toContain("static CURRENT_TASK: RefCell<Option<String>>");
    expect(taskSource).toContain("pub fn cancel(install_path: &str)");
    expect(taskSource).toContain("pub fn begin(install_path: &str)");
    expect(rustSource).toContain("fn pause_game_download(install_path: Option<String>)");
    expect(rustSource).toContain("download_task::cancel(path)");

    // 前端暂停/取消都要指明是哪一档。
    expect(appSource).toContain('invoke("pause_game_download", { installPath: installPath.value })');
    expect(appSource).toContain('invoke("cancel_game_operation", { installPath: installPath.value })');
  });

  it("侧栏能显示别的档位正在下载的进度", () => {
    expect(appSource).toContain("const gameDownloadPercents = computed<Record<string, number>>");
    expect(appSource).toContain(':download-percents="gameDownloadPercents"');
    const railSource = readFileSync(
      resolve(process.cwd(), "src/components/PlatformGameRail.vue"),
      "utf8",
    );
    expect(railSource).toContain("downloadPercents?: Record<string, number>");
    expect(railSource).toContain("platform-game-button__progress");
  });

  it("开发页按档位分开：公告、渠道开关、填写项各走各的", () => {
    // Rust：两条发布命令都带 game_id，写 notices/<档位>.json、channels/<档位>.json。
    expect(rustSource).toContain("async fn dev_publish_remote_notice(\n    game_id: Option<String>,");
    expect(rustSource).toContain("async fn dev_publish_download_channels(\n    game_id: Option<String>,");
    expect(rustSource).toContain("fn dev_publish_remote_paths(game_id: Option<&str>, segment: &str, legacy_path: &str)");
    expect(rustSource).toContain('"channels"');
    expect(rustSource).toContain('"notices"');
    // 零境额外写一份老路径：安卓端只认老文件，那边不做平台。
    expect(rustSource).toContain("if id.eq_ignore_ascii_case(\"crossing-void\")");

    // 共用内核：分档位地址 + 迁移期回退老文件。
    const coreSource = readFileSync(resolve(process.cwd(), "src/remoteLauncherInfo.ts"), "utf8");
    expect(coreSource).toContain("export function launcherNoticeUrl(gameId?: string | null)");
    expect(coreSource).toContain("export function downloadChannelsUrl(gameId?: string | null)");
    expect(appSource).toContain("async function fetchPerGameRemoteDocument(");

    // 开发页填写项按档位存。
    const devSource = readFileSync(resolve(process.cwd(), "src/dev/useDeveloperConsole.ts"), "utf8");
    expect(devSource).toContain("function devGameKey(base: string)");
    expect(devSource).toContain("gameId: activeGameId.value");
    expect(appSource).toContain("const developerConsole = useDeveloperConsole({\n  launcherVersion,\n  activeGameId,");
  });

  it("切档弹这一档的公告，同一份只弹一次，重启重置", () => {
    // 记忆只放内存（Set），不落盘 —— 重启启动器就重置。
    expect(appSource).toContain("const shownLauncherNoticeKeys = new Set<string>();");
    expect(appSource).toContain("const noticeKey = `${activeGameId.value}:${notice.id}`");
    expect(appSource).toContain("notice.enabled && !shownLauncherNoticeKeys.has(noticeKey)");
    expect(appSource).toContain("shownLauncherNoticeKeys.add(noticeKey)");
    // 不许把它持久化：一旦落盘就变成"永远不再弹"。
    expect(appSource).not.toContain("localStorage.setItem(SHOWN_NOTICE");
  });

  it("非零境档位读不到公告/开关时不许回退成零境那份", () => {
    const block = appSource.slice(
      appSource.indexOf("async function fetchPerGameRemoteDocument("),
      appSource.indexOf("async function refreshRemoteDownloadChannels()"),
    );
    // 回退只对零境（老文件就是它那份）成立；别的档位必须原样抛错。
    expect(block).toContain("if (gameId !== DEFAULT_PLATFORM_GAME_ID) throw error;");
  });

  it("发布脚本会给新子目录补读权限（否则 IIS 401，发出去也读不到）", () => {
    for (const name of [
      "Scripts/Publish-LauncherRemoteNotice.ps1",
      "Scripts/Publish-LauncherDownloadChannels.ps1",
    ]) {
      const script = readFileSync(resolve(process.cwd(), name), "utf8");
      // 新目录（notices / channels）里没有 index.html，必须退到上级目录找 ACL 模板，
      // 并且无论有没有模板都补一次匿名读权限。
      expect(script, name).toContain("foreach (`$aclDir in @(`$targetDir, (Split-Path -Parent `$targetDir)))");
      expect(script, name).toContain("icacls `$targetDir /grant 'IIS_IUSRS:(OI)(CI)(RX)' 'IUSR:(OI)(CI)(RX)'");
    }
  });
});
