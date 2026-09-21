import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { launcherSource, readSource } from "./helpers/launcherSources";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("launcher behavior settings", () => {
  it("manages remote download channels from the developer page", () => {
    // 开发页：每个渠道独立开关（整站说明交给远程公告），发布走新的 Tauri 命令。
    expect(launcherSource).toContain("dev_publish_download_channels");
    expect(launcherSource).toContain("developerChannels");
    expect(launcherSource).toContain("全部恢复");
    // 玩家侧：拉取渠道开关 → 关闭的渠道不能选、当前渠道被关自动切换、下载入口兜底拦住。
    expect(appSource).toContain("refreshRemoteDownloadChannels");
    expect(appSource).toContain("pickAvailableDownloadChannel");
    expect(appSource).toContain("isDownloadChannelEnabled(downloadChannelStates.value, downloadSource.value)");
    expect(launcherSource).toContain("downloadChannelNoticeText");
    // 渠道被关时复用右上角那条提示（和"流量不足"同一套外观），文案固定。
    expect(appSource).toContain("当前渠道已关闭，请更换");
    expect(appSource).toContain("downloadChannelWarningText || showOfficialTrafficWarning");
  });

  it("renders checkboxes through the shared component instead of raw inputs", () => {
    // 复选框外观只有一份实现（LauncherCheckbox + 全局 controls.css），
    // 别再各写各的原生 checkbox，否则开发页那块会跑出浏览器默认样式。
    // 安装弹窗里那一行（原 `.install-option`）也并进了同一个组件 ——
    // 它只是尺寸更紧凑，差异写在 install-dialogs.css 的 `.install-panel .check-row` 里。
    expect(readSource("src/components/LauncherCheckbox.vue")).toContain("check-box");
    expect(readSource("src/components/SettingsPanel.vue")).toContain("LauncherCheckbox");
    expect(appSource).toContain("LauncherCheckbox");
    expect(appSource).not.toContain('class="check-box"');
    expect(launcherSource).not.toContain("install-option");
    expect(launcherSource).not.toContain('type="checkbox"');
  });

  it("renders radio rows through the shared component too", () => {
    // 单选框和复选框同一条规则：圆点和悬停变色只在 LauncherRadio / controls.css 里有一份，
    // 设置页不该再手写 <span class="radio-dot">。
    expect(readSource("src/components/LauncherRadio.vue")).toContain("radio-dot");
    expect(readSource("src/components/SettingsPanel.vue")).toContain("LauncherRadio");
    expect(readSource("src/components/SettingsPanel.vue")).not.toContain('class="radio-dot"');
    expect(readSource("src/styles/controls.css")).toContain(".radio-row:hover");
  });

  it("persists automatic repair and post-launch visibility choices", () => {
    expect(appSource).toContain("AUTO_REPAIR_STORAGE_KEY");
    expect(appSource).toContain("HIDE_AFTER_GAME_LAUNCH_STORAGE_KEY");
    expect(appSource).toContain("watch(autoRepair");
    expect(appSource).toContain("watch(hideAfterGameLaunch");
  });

  it("persists the selected download source independently from download tasks", () => {
    expect(appSource).toContain("DOWNLOAD_SOURCE_STORAGE_KEY");
    expect(appSource).toContain("window.localStorage.getItem(DOWNLOAD_SOURCE_STORAGE_KEY)");
    expect(appSource).toContain("watch(downloadSource");
    expect(appSource).toContain("window.localStorage.setItem(DOWNLOAD_SOURCE_STORAGE_KEY, source)");
  });

  it("offers destructive download cancellation separately from pause", () => {
    expect(appSource).toContain('confirmAction.value = "cancelDownload"');
    expect(launcherSource).toContain('t("settings.cancelDownload")');
    expect(appSource).toContain('t("confirm.cancelDownloadBody")');
    expect(launcherSource).toContain('@click="requestCancelGameDownload"');
  });

  it("runs the lightweight automatic repair check before launching", () => {
    expect(appSource).toContain("ensureAutomaticRepairBeforeLaunch");
    expect(appSource).toContain('invoke<ManifestVerifySummary>("check_game_manifest_files"');
  });

  it("allows integrity checks without an installed game and downloads when no manifest exists", () => {
    const availability = appSource.match(/const canVerifyGameIntegrity = computed\([\s\S]*?\n\);/)?.[0];
    const verification = appSource.match(/async function verifyGameIntegrity\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(availability).toBeTruthy();
    expect(availability).not.toContain("hasLocalInstalledGame.value");
    expect(availability).not.toContain('launcherState.value !== "repairPending"');
    expect(verification).toContain("hasRepairableGameManifest");
    expect(verification).toContain("markFullGameDownloadRequired");
    expect(appSource).toContain('state: "repairable"');
  });

  it("searches below the selected folder when relocating an installed game", () => {
    expect(appSource).toContain('invoke<string | null>("find_game_installation"');
  });

  it("moves an installed game into a newly selected install location", () => {
    const migration = appSource.slice(
      appSource.indexOf("async function migrateInstalledGame()"),
      appSource.indexOf("async function confirmGameMigration()"),
    );
    const confirmation = appSource.slice(
      appSource.indexOf("async function confirmGameMigration()"),
      appSource.indexOf("async function handlePrimaryAction()"),
    );

    expect(migration).toContain("async function migrateInstalledGame()");
    expect(migration).toContain('installDialogMode.value = "migration"');
    expect(migration).toContain("showInstallConfirm.value = true");
    expect(migration).not.toContain('invoke<string>("move_game_installation"');
    expect(confirmation).toContain('invoke<string>("move_game_installation"');
    expect(confirmation).toContain("selectedInstallBasePath.value");
    expect(appSource).toContain('invoke<number>("get_game_migration_size"');
    expect(appSource).toContain('installDialogMode.value === "migration" && migrationChangesVolume.value');
    expect(migration).not.toContain("!hasLocalInstalledGame.value");
    expect(launcherSource).toContain('t("settings.migrateGame")');
    expect(appSource).not.toContain(':disabled="gameMigrationPending || !hasLocalInstalledGame || gameRunning"');
    expect(appSource).toContain("installDialogTitle");
    expect(appSource).toContain("installDialogConfirmText");
    expect(appSource).toContain("installDialogMode === 'install' || migrationChangesVolume");
    expect(appSource).toContain('showCheckResult(`无法打开游戏目录：${formatUnknownError(error)}`)');
  });

  it("lets the player turn off the system proxy for Github downloads", () => {
    // 2026-09-21 用户实测：某些本地代理在大流量长传输上断崖衰减（5.9 MB/s → 124 KB/s → 29 KB/s），
    // 同一个文件直连稳在 10 MB/s。但"不挂代理连不上 GitHub"的人也存在，所以做成开关、默认开（老行为）。
    expect(appSource).toContain("GITHUB_USE_SYSTEM_PROXY_STORAGE_KEY");
    expect(appSource).toContain("const githubUseSystemProxy = ref(");
    expect(appSource).toContain("await syncGithubProxySetting()");
    expect(appSource).toContain('invoke("set_github_use_system_proxy"');
    expect(readSource("src/components/SettingsPanel.vue")).toContain("githubUseSystemProxy");
    expect(launcherSource).toContain("settings.githubUseSystemProxy");

    expect(nativeSource).toContain("static GITHUB_USE_SYSTEM_PROXY");
    expect(nativeSource).toContain("fn set_github_use_system_proxy(enabled: bool)");
    expect(nativeSource).toContain("            set_github_use_system_proxy,");
    // 下载和"网络检测"必须同一个判据：不然检测说"已检测到代理"，实际下载却走直连。
    expect(nativeSource).toContain("is_github_url(url) && GITHUB_USE_SYSTEM_PROXY.load(Ordering::SeqCst)");
    expect(nativeSource).toContain("let proxy_url = GITHUB_USE_SYSTEM_PROXY");
  });

  it("lets the player turn off the automatic download-source fallback", () => {
    // 用户 2026-09-21：默认还是自动换源（首选源取不到就换另一个），但设置里要能关掉 ——
    // 关掉后每个文件只带一个地址（只用玩家选的那个源），测某个源的速度才有意义。
    expect(appSource).toContain("AUTO_SOURCE_FALLBACK_STORAGE_KEY");
    expect(appSource).toContain("const autoSourceFallback = ref(");
    expect(readSource("src/components/SettingsPanel.vue")).toContain("autoSourceFallback");
    expect(launcherSource).toContain("settings.autoSourceFallback");

    const packageDownload = appSource.slice(
      appSource.indexOf("async function downloadGamePackageFiles()"),
      appSource.indexOf("async function finalizeGamePackageInstall()"),
    );
    expect(packageDownload).toContain("const allowFallback = autoSourceFallback.value");
    expect(packageDownload).toContain(
      "officialEnabled: preferOfficial || (allowFallback && officialChannelOn)",
    );
    expect(packageDownload).toContain(
      "githubEnabled: !preferOfficial || (allowFallback && githubChannelOn)",
    );
  });

  it("does not nudge the player to support the author in the download settings", () => {
    // 用户 2026-09-21 要求去掉官方源下面那句"可以在启动器主界面顶部支持一下作者"。
    // 留下的是流量不足的告警；Github 那条提示必须写成 v-else-if，
    // 否则官方源正常时也会跟着冒出来（原来它是 v-else）。
    expect(launcherSource).not.toContain("supportHint");
    const panel = readSource("src/components/SettingsPanel.vue");
    expect(panel).toContain("v-if=\"downloadSource === 'official' && officialTrafficBlocked\"");
    expect(panel).toContain("v-else-if=\"downloadSource === 'github'\"");
    expect(panel).toContain('t("traffic.lowHint")');
  });

  it("opens the game log folder through its own native command", () => {
    // 「打开游戏日志」以前是个没有 @click 的按钮（点了什么都不发生）。
    // 日志落在 %LOCALAPPDATA%\<工程名>\Saved\Logs，和安装目录无关，
    // 所以路径由 Rust 解析，前端只负责点击。
    expect(readSource("src/components/SettingsPanel.vue")).toContain('@click="openGameLogFolder"');
    expect(appSource).toContain('invoke("open_game_log_folder")');
    expect(nativeSource).toContain("fn open_game_log_folder()");
    expect(nativeSource).toContain("            open_game_log_folder,");
    expect(nativeSource).toContain('const GAME_PROJECT_NAME: &str = "CrossingVoid";');
    expect(nativeSource).toContain(".join(GAME_PROJECT_NAME)");
  });

  it("does not treat Explorer's non-zero exit code as a folder-open failure", () => {
    const windowsOpenFolder = nativeSource.slice(
      nativeSource.indexOf("fn open_folder(path"),
      nativeSource.indexOf("fn install_vc_redist_internal"),
    );

    expect(windowsOpenFolder).toContain(".spawn()");
    expect(windowsOpenFolder).not.toContain(".status()");
    expect(windowsOpenFolder).not.toContain("Explorer failed with exit code");
  });
});
