import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("launcher behavior settings", () => {
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
});
