import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

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

  it("offers destructive download cancellation separately from pause", () => {
    expect(appSource).toContain('confirmAction.value = "cancelDownload"');
    expect(appSource).toContain('t("settings.cancelDownload")');
    expect(appSource).toContain('t("confirm.cancelDownloadBody")');
    expect(appSource).toContain('@click="requestCancelGameDownload"');
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
    expect(appSource).toContain('t("settings.migrateGame")');
    expect(appSource).not.toContain(':disabled="gameMigrationPending || !hasLocalInstalledGame || gameRunning"');
    expect(appSource).toContain("installDialogTitle");
    expect(appSource).toContain("installDialogConfirmText");
    expect(appSource).toContain("installDialogMode === 'install' || migrationChangesVolume");
    expect(appSource).toContain('showCheckResult(`无法打开游戏目录：${formatUnknownError(error)}`)');
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
