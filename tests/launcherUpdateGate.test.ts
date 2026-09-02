import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("mandatory launcher update gate", () => {
  it("checks the launcher before revealing normal game actions", () => {
    expect(appSource).toContain('const launcherUpdateGate = ref<LauncherUpdateGate>("checking")');
    const platformInitialization = appSource.slice(
      appSource.indexOf("async function initializePlatformPage"),
      appSource.indexOf("async function selectPlatformGame"),
    );
    expect(platformInitialization).toContain("await checkLauncherUpdate({ manual: false })");
    expect(platformInitialization).toContain("await checkGameVersion({ manual: false })");
    expect(platformInitialization.indexOf("checkLauncherUpdate")).toBeLessThan(
      platformInitialization.indexOf("checkGameVersion"),
    );
    expect(appSource.indexOf("await initializePlatformPage()")).toBeLessThan(appSource.lastIndexOf("hideBootSplash()"));
  });

  it("blocks network operations without blocking an installed local game", () => {
    expect(appSource).toContain("const launcherNetworkLocked = computed");
    expect(appSource).toContain("localGamePlayableWhileNetworkLocked");
    expect(appSource).not.toContain('v-if="launcherAccessLocked && !showGameChunkImportGuide"');
    expect(appSource).not.toContain("const launcherAccessLocked = computed");
  });

  it("bypasses launcher updates in Vite and native Debug development builds", () => {
    const checkLauncherUpdate = appSource.slice(
      appSource.indexOf("async function checkLauncherUpdate"),
      appSource.indexOf("async function installPendingLauncherUpdate"),
    );

    expect(checkLauncherUpdate).toContain("await isDevelopmentBuild()");
    expect(checkLauncherUpdate).toContain('launcherUpdateGate.value = "ready"');
    expect(checkLauncherUpdate).toContain("开发版不参与启动器更新检查。");
    expect(checkLauncherUpdate.indexOf("await isDevelopmentBuild()")).toBeLessThan(checkLauncherUpdate.indexOf("await check()"));
  });

  it("uses the native debug assertion flag instead of inferring Debug mode from a path", () => {
    expect(appSource).toContain('invoke<boolean>("is_debug_build")');
    expect(appSource).toContain("async function isDevelopmentBuild()");
    expect(readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8"))
      .toContain("fn is_debug_build() -> bool");
  });

  it("shows launcher update progress in the shared progress dock", () => {
    expect(appSource).toContain("launcherUpdateStatusCopy");
    expect(appSource).toContain("launcherUpdateProgressPercent");
    expect(appSource).toContain("launcherUpdateProgressDetail");
    expect(appSource).not.toContain("launcher-update-mask");
  });

  it("rechecks the latest launcher at every network game download boundary", () => {
    const downloadSource = appSource.slice(
      appSource.indexOf("async function downloadGameArchive"),
      appSource.indexOf("async function installDownloadedGameArchive"),
    );
    const repairSource = appSource.slice(
      appSource.indexOf("async function repairMissingGameFiles"),
      appSource.indexOf("function requestDeleteGame"),
    );

    expect(appSource).toContain("async function ensureLatestLauncherForNetworkDownload");
    expect(downloadSource).toContain("await ensureLatestLauncherForNetworkDownload()");
    expect(repairSource).toContain("await ensureLatestLauncherForNetworkDownload()");
  });

  it("submits the current PC launcher version when requesting an OSS URL", () => {
    const signerSource = appSource.slice(
      appSource.indexOf("async function resolveBackendDownloadUrl"),
      appSource.indexOf("async function resolveBackendChunks"),
    );

    expect(signerSource).toContain("launcherVersion: launcherVersion.value");
  });
});
