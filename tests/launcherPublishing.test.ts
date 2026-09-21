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

  it("ships a Simplified Chinese installer instead of NSIS's English default", () => {
    const config = JSON.parse(tauriConfig) as {
      bundle: { windows: { nsis: { languages: string[]; displayLanguageSelector: boolean } } };
    };
    // 不写 languages 时 Tauri 只会生成 MUI_LANGUAGE "English"：
    // 安装向导、卸载器、以及"已安装/维护操作"那一页全是英文。
    expect(config.bundle.windows.nsis.languages).toEqual(["SimpChinese"]);
    expect(config.bundle.windows.nsis.displayLanguageSelector).toBe(false);
  });

  it("keeps a manual setup.exe from uninstalling the launcher by accident", () => {
    // Tauri 的 NSIS 模板里有一页"已安装 → 选择维护操作"，升级场景默认选中
    // 「安装前卸载」，点下一步就真的先跑旧版卸载器。手动双击安装包时点错或者
    // 中途关窗口，机器上就只剩一个空目录（用户实测踩到过）。
    // 构建脚本在编译前把这一页整页跳过，模板结构变了就直接构建失败。
    const scriptPath = resolve(process.cwd(), "Scripts/Build-LauncherUpdaterPackage.ps1");
    const sample = [
      "Page custom PageReinstall PageLeaveReinstall",
      "Function PageReinstall",
      "  ReadRegStr $R0 SHCTX 'k' ''",
      "FunctionEnd",
      "",
    ].join("\r\n");
    const command = [
      `$source = Get-Content -Raw -LiteralPath '${scriptPath.replaceAll("'", "''")}'`,
      `Invoke-Expression ([regex]::Match($source, '(?m)^\\$script:NsisReinstallPageMarker = .*').Value)`,
      `Invoke-Expression ([regex]::Match($source, '(?s)function Disable-NsisReinstallPage.{0,3000}?\\r?\\n\\}\\r?\\n').Value)`,
      `$sample = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(sample, "utf8").toString("base64")}'))`,
      `$patched = Disable-NsisReinstallPage -ScriptText $sample`,
      `"patched:"`,
      `$patched`,
      `"unchanged:"`,
      `(Disable-NsisReinstallPage -ScriptText $patched) -eq $patched`,
    ].join("; ");

    const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    const patched = output.slice(output.indexOf("patched:") + "patched:".length, output.indexOf("unchanged:"));
    const lines = patched.split(/\r?\n/).map((line) => line.trim());
    const start = lines.indexOf("Function PageReinstall");
    expect(start).toBeGreaterThanOrEqual(0);
    // 页面函数第一句就是 Abort：整页跳过，永远走不到那个"安装前先卸载"的分支。
    expect(lines.slice(start + 1, start + 6)).toContain("Abort");
    expect(output.trimEnd().endsWith("True")).toBe(true);
  });
});
