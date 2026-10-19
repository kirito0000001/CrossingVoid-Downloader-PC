import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const manifestSource = readFileSync(resolve(process.cwd(), "src/launcherUpdateManifest.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const publisherSource = readFileSync(
  resolve(process.cwd(), "Scripts/Publish-LauncherGiteePackage.ps1"),
  "utf8",
);

const checkLauncherUpdate = appSource.slice(
  appSource.indexOf("async function checkLauncherUpdate"),
  appSource.indexOf("function offerLauncherUpdate"),
);
const installPendingLauncherUpdate = appSource.slice(
  appSource.indexOf("async function installPendingLauncherUpdate"),
  appSource.indexOf("function handleLauncherUpdateDownloadEvent"),
);
const downloadLauncherInstaller = rustSource.slice(
  rustSource.indexOf("async fn download_launcher_installer"),
  rustSource.indexOf("fn install_launcher_installer"),
);

describe("launcher update channel", () => {
  // 2026-10-19 起：旧通道（www 上会签 OSS 临时链接的接口 + `download-server-xj` bucket）整体退役，
  // bucket 已删除，那个接口返回的地址必然 404。客户端只认站点静态清单。
  it("只从站点静态清单取版本，不碰 gitee raw 和已退役的 OSS 接口", () => {
    expect(manifestSource).toContain(
      "https://www.crossingvoid.top/manifests/launcher/pc-installer-latest.json",
    );
    expect(manifestSource).not.toContain("gitee.com");
    expect(manifestSource).not.toContain("toolbox-updates");
    expect(manifestSource).not.toContain("aliyuncs.com");
  });

  it("扁平清单落后时仍然去问 Tauri 端点，不允许静默漏更", () => {
    // 发布时两份镜像不是原子的：扁平清单停在上一版时，只看它就会永远判"已是最新"。
    const flatIndex = checkLauncherUpdate.indexOf("await resolveFlatLauncherUpdate()");
    const tauriIndex = checkLauncherUpdate.indexOf("checkTauriLauncherUpdate()");
    const upToDateIndex = checkLauncherUpdate.indexOf("启动器已是最新版本");

    expect(flatIndex).toBeGreaterThan(-1);
    expect(tauriIndex).toBeGreaterThan(flatIndex);
    // 交叉确认必须在宣布"已是最新"之前发生
    expect(tauriIndex).toBeLessThan(upToDateIndex);
  });

  it("扁平清单坏掉时退回 Tauri 端点，两条都不通才算检查失败", () => {
    expect(checkLauncherUpdate).toContain("if (flatError) throw error;");
    expect(checkLauncherUpdate).toContain('launcherUpdateGate.value = "verificationFailed"');
    // 兜底通道在开机流程里，必须有上限，不能把加载界面一起拖住
    expect(appSource).toContain("const LAUNCHER_UPDATE_TAURI_CHECK_TIMEOUT_MS = 6000;");
    expect(appSource).toContain("Promise.race([pendingCheck, timeout])");
  });

  it("更新失败后把清单留着，玩家可以原地重试（不用重启启动器）", () => {
    expect(installPendingLauncherUpdate).toContain("pendingLauncherUpdate.value = pending;");
    expect(installPendingLauncherUpdate).toContain('launcherUpdateConfirmStage.value = "available";');
    // 失败收尾不能再走"整份清空"的老路：那样闸门还停在 updateRequired，
    // 界面只剩"仅可使用本地功能"，只能重启启动器等下一次开机检查。
    expect(installPendingLauncherUpdate).not.toContain("resetLauncherUpdateProgress()");
  });

  it("安装包只由 Rust 拉起，参数与 tauri-plugin-updater 的 NSIS 约定逐字一致", () => {
    // `/P` 被动安装、`/R` 装完重开、`/UPDATE` 覆盖安装分支（installer-hooks.nsh 读 $UpdateMode）、
    // `/ARGS` 装完重开时要带的参数。少一个就退化成"首次安装"或装完不启动。
    expect(rustSource).toContain(
      'const LAUNCHER_INSTALLER_ARGS: [&str; 4] = ["/P", "/R", "/UPDATE", "/ARGS"];',
    );
    expect(rustSource).toContain("command.args(LAUNCHER_INSTALLER_ARGS);");
    expect(rustSource).toContain("download_launcher_installer,");
    expect(rustSource).toContain("install_launcher_installer,");
  });

  it("启动器更新的下载有自己的取消作用域，不会被暂停过的游戏下载误杀", () => {
    // `verify_sha256` 每一步都问 `check_download_cancelled()`；没进任务作用域的线程会退回
    // 进程级标志，玩家这轮暂停过旧链路游戏下载时，安装包会在校验那一步被判 DOWNLOAD_CANCELLED。
    expect(downloadLauncherInstaller).toContain("download_task::begin(LAUNCHER_UPDATE_TASK_KEY);");
  });

  it("发布侧先把下载地址验活，再提交清单", () => {
    expect(publisherSource).toContain("function Assert-GiteeAssetDownloadable");
    const verifyIndex = publisherSource.indexOf("Assert-GiteeAssetDownloadable -Url");
    const publishIndex = publisherSource.indexOf(
      "Publish-GiteeRepositoryFile -LocalPath $latestManifestPath",
    );
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeLessThan(publishIndex);
  });

  it("清单里的地址用 Gitee 回给的真实资产地址，不靠本地拼接", () => {
    expect(publisherSource).toContain("browser_download_url");
    expect(publisherSource).toContain("$downloadUrl = $resolvedDownloadUrl");
  });

  it("两份站点镜像必须一批换完，只换成功一份就等于静默停更", () => {
    expect(publisherSource).toContain("function Publish-WebsiteMirrorSet");
    expect(publisherSource).toContain("Publish-WebsiteMirrorSet -Files @(");
    // 覆盖之后要回读两份、断言版本一致
    expect(publisherSource).toContain("站点镜像覆盖后校验失败");
    // 旧的一次一份的写法不允许再出现（那正是"一半新一半旧"的来源）
    expect(publisherSource).not.toContain("Publish-WebsiteMirrorFile ");
  });
});
