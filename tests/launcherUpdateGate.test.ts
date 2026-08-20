import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("mandatory launcher update gate", () => {
  it("checks the launcher before revealing normal game actions", () => {
    expect(appSource).toContain('const launcherUpdateGate = ref<LauncherUpdateGate>("checking")');
    expect(appSource).toContain("await checkUpdatesInOrder({ manual: false })");
    expect(appSource.indexOf("await checkUpdatesInOrder({ manual: false })")).toBeLessThan(appSource.lastIndexOf("hideBootSplash()"));
  });

  it("blocks game operations until launcher verification succeeds", () => {
    expect(appSource).toContain('const launcherAccessLocked = computed(() => launcherUpdateGate.value !== "ready")');
    expect(appSource).toContain("if (launcherAccessLocked.value) return;");
    expect(appSource).toContain('v-if="launcherAccessLocked && !showGameChunkImportGuide"');
    expect(appSource).toContain("启动器需要更新");
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

  it("shows update progress inside the mandatory update dialog", () => {
    const mandatoryDialog = appSource.slice(
      appSource.indexOf('v-if="launcherAccessLocked && !showGameChunkImportGuide"'),
      appSource.indexOf("</section>", appSource.indexOf('v-if="launcherAccessLocked && !showGameChunkImportGuide"')),
    );

    expect(mandatoryDialog).toContain("launcherUpdateStatusCopy");
    expect(mandatoryDialog).toContain("launcherUpdateProgressPercent");
    expect(mandatoryDialog).toContain("launcherUpdateProgressDetail");
    expect(mandatoryDialog).toContain(':disabled="launcherUpdateActive"');
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
