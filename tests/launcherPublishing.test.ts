import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ossPublisher = readFileSync(
  resolve(process.cwd(), "Scripts/Publish-LauncherUpdaterPackage.ps1"),
  "utf8",
);
const giteePublisher = readFileSync(
  resolve(process.cwd(), "Scripts/Publish-LauncherGiteePackage.ps1"),
  "utf8",
);
const giteePackageBuilder = readFileSync(
  resolve(process.cwd(), "Scripts/Build-LauncherUpdaterPackage.ps1"),
  "utf8",
);
const tauriConfig = readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8");
const installerHooks = readFileSync(resolve(process.cwd(), "src-tauri/installer-hooks.nsh"), "utf8");

describe("launcher publishing", () => {
  it("keeps the legacy PC product while publishing a canonical PC manifest", () => {
    expect(ossPublisher).toContain('LegacyProductKey = "crossingvoid-launcher"');
    expect(ossPublisher).toContain('PcProductKey = "crossingvoid-launcher-pc"');
    expect(ossPublisher).toContain('AndroidProductKey = "crossingvoid-launcher-android"');
    expect(ossPublisher).toContain("ServerPcUpdateJsonPath");
    expect(ossPublisher).toContain("update.pc.json");
  });

  it("publishes OSS compatibility after the Gitee launcher release", () => {
    expect(giteePublisher).toContain("Publish-LauncherUpdaterPackage.ps1");
    expect(giteePublisher).toContain("-SkipBuild");
    expect(giteePublisher).toContain("-InstallerPath");
    expect(giteePublisher).toContain("-ManifestPath");
  });

  it("writes the OSS object key to latest and versioned launcher assets", () => {
    expect(ossPublisher).toContain("Set-LauncherManifestObjectKey");
    expect(ossPublisher).toContain("$Manifest.latest.assets");
    expect(ossPublisher).toContain("$Manifest.versions");
  });

  it("keeps launcher publication dates in RFC 3339 after PowerShell JSON deserialization", () => {
    const utilityPath = resolve(process.cwd(), "Scripts/LauncherManifestUtilities.ps1");
    const command = [
      `. '${utilityPath.replaceAll("'", "''")}'`,
      `$release = '{"publishedAt":"2026-07-19T16:55:21.9734963Z"}' | ConvertFrom-Json`,
      `Convert-ToRfc3339Timestamp $release.publishedAt`,
    ].join("; ");

    const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
    }).trim();

    expect(output).toBe("2026-07-19T16:55:21.9734963Z");
    expect(giteePublisher).toContain("Convert-ToRfc3339Timestamp $release.publishedAt");
  });

  it("checks PC launcher updates through the stable website manifest", () => {
    expect(tauriConfig).toContain(
      "https://www.crossingvoid.top/api/toolbox-updates/tauri/crossingvoid-launcher-pc/windows/x86_64/{{current_version}}",
    );
    expect(tauriConfig).not.toContain("gitee.com");
  });

  it("never recursively deletes the configured launcher output directory", () => {
    expect(giteePackageBuilder).not.toContain(
      "Remove-Item -LiteralPath $resolvedReleaseDir -Recurse -Force",
    );
    expect(giteePackageBuilder).toContain(
      "New-Item -ItemType Directory -Path $resolvedReleaseDir -Force",
    );
  });

  it("waits for the old launcher process to exit before an update overwrites files", () => {
    expect(tauriConfig).toContain('"installerHooks": "installer-hooks.nsh"');
    expect(installerHooks).toContain("NSIS_HOOK_PREINSTALL");
    expect(installerHooks).toContain("$UpdateMode");
    expect(installerHooks).toContain("FindProcessCurrentUser");
    expect(installerHooks).toContain("Sleep 250");
    expect(installerHooks).toContain("$R8 < 20");
  });
});
