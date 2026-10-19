import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const libSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const packageSource = readFileSync(resolve(process.cwd(), "src-tauri/src/game_package.rs"), "utf8");

/**
 * 安装阶段"窗口未响应"守卫。
 *
 * Tauri 的同步命令跑在主线程上：以前安装收尾里的 `install_vc_redist`（等 msiexec/UAC）和
 * `create_game_desktop_shortcut_now`（起 PowerShell）都是同步命令，界面就卡在
 * "校验安装包 100%" 然后被 Windows 标成未响应（2026-10-19 幻杀 0.1.0 安装现场）。
 */
describe("installation responsiveness", () => {
  it("keeps the full-package scan on the blocking pool", () => {
    expect(packageSource).toContain("pub async fn scan_local_game_package");
    const scan = packageSource.slice(
      packageSource.indexOf("pub async fn scan_local_game_package"),
      packageSource.indexOf("pub async fn download_game_package"),
    );
    expect(scan).toContain("tauri::async_runtime::spawn_blocking");
  });

  it("moves the installer tail off the main thread", () => {
    for (const name of ["install_vc_redist", "create_game_desktop_shortcut_now"]) {
      const start = libSource.indexOf(`async fn ${name}`);
      expect(start, `${name} 必须是 async 命令`).toBeGreaterThan(-1);
      const body = libSource.slice(start, start + 900);
      expect(body, `${name} 必须丢进 spawn_blocking`).toContain(
        "tauri::async_runtime::spawn_blocking",
      );
      expect(libSource, `${name} 不能退回同步命令`).not.toContain(`\nfn ${name}(`);
    }
  });

  it("moves the install overlay to 完成安装 once verification passes", () => {
    const finalize = appSource.slice(
      appSource.indexOf("async function finalizeGamePackageInstall"),
      appSource.indexOf("async function updateRemoteArchiveInfo"),
    );
    expect(finalize).toContain('installProgressStage.value = "finishing"');
    // 顺序：先整包校验，校验通过后才切"完成安装"
    expect(finalize.indexOf('installProgressStage.value = "finishing"')).toBeGreaterThan(
      finalize.indexOf("const verifiedPlan = await verifyInstalledPackageFiles(manifest)"),
    );
  });
});
