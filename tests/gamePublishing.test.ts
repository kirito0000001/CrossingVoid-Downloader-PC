import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const wrapperSource = readFileSync(resolve(process.cwd(), "Scripts/Publish-GamePackage.ps1"), "utf8");
const releaseSource = readFileSync(
  resolve(process.cwd(), "Scripts/Publish-GamePackageCore.ps1"),
  "utf8",
);

describe("developer game publishing", () => {
  it("offers separate PC and Android package actions with shared release metadata", () => {
    expect(appSource).toContain("上传游戏本体");
    expect(appSource).toContain("上传 PC 游戏包");
    expect(appSource).toContain("上传 Android 游戏包");
    expect(appSource).toContain("上传 PC 测试服游戏包");
    expect(appSource).toContain("上传 Android 测试服游戏包");
    expect(appSource).toContain('v-model="developerGameVersion"');
    expect(appSource).toContain('v-model="developerGameTitle"');
    expect(appSource).toContain('DEV_GAME_VERSION_STORAGE_KEY) || "V0.5.12"');
  });

  it("keeps the game publishing implementation inside the PC launcher project", () => {
    expect(wrapperSource).toContain('Join-Path $PSScriptRoot "Publish-GamePackageCore.ps1"');
    expect(wrapperSource).not.toContain("../CrossingVoid");
  });

  it("sends the selected platform and folder to the native publisher", () => {
    expect(appSource).toContain('channel: "Stable" | "Test"');
    expect(appSource).toContain("developerGamePublishContext.value = context");
    expect(appSource).toContain("script: taskKind");
    expect(appSource).toContain("gameDirectory: context.gameDirectory");
    expect(appSource).toContain("releaseVersion: context.releaseVersion");
    expect(appSource).toContain("releaseTitle: context.releaseTitle");
    expect(appSource).toContain("gameChannel: context.channel");
  });

  it("isolates stable and test server manifests and product keys", () => {
    expect(wrapperSource).toContain('[ValidateSet("Stable", "Test")]');
    expect(wrapperSource).toContain("-Channel $Channel");
    expect(releaseSource).toContain('"crossingvoid-game-test"');
    expect(releaseSource).toContain('"crossingvoid-android-game-test"');
    expect(releaseSource).toContain("Remove-PreviousChannelObjects");
    expect(releaseSource).toContain("DryRun：跳过本机后端清单同步");
  });

  it("forces UTF-8 progress output for the wrapper and Unreal publisher", () => {
    for (const source of [wrapperSource, releaseSource]) {
      expect(source).toContain("$OutputEncoding = [System.Text.UTF8Encoding]::new($false)");
      expect(source).toContain("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)");
      expect(source).toContain('$PSStyle.OutputRendering = "PlainText"');
    }
  });

  it("uses 500MB user-readable chunks on every platform", () => {
    expect(releaseSource).toContain(
      '$chunkSizeBytes = [int64](500MB)',
    );
    expect(releaseSource).toContain('"CrossingVoid电脑端.碎片"');
    expect(releaseSource).toContain('"CrossingVoid手机端.碎片"');
  });

  it("packages only the Android APK and OBB files", () => {
    expect(releaseSource).toContain('Where-Object { $_.Extension -ieq ".apk" }');
    expect(releaseSource).toContain('Where-Object { $_.Extension -ieq ".obb" }');
    expect(releaseSource).toContain("Android 打包目录必须只包含一个 APK 和一个 OBB");
  });

  it("reports the current chunk while uploading to GitHub and OSS", () => {
    expect(releaseSource).toContain('正在上传到 GitHub：第 $assetIndex / $ChunkCount 片');
    expect(releaseSource).toContain("$ChunkCount=$chunks.Count");
    expect(releaseSource).toContain('正在上传到阿里云 OSS：第 $assetIndex / $($chunks.Count) 片');
  });

  it("publishes only the v2 download metadata contract", () => {
    expect(releaseSource).toContain("schemaVersion=2");
    expect(releaseSource).toContain("downloadReleaseTag=$releaseTag");
    expect(releaseSource.indexOf('$releaseTag="$Platform-$version"')).toBeLessThan(
      releaseSource.indexOf("downloadReleaseTag=$releaseTag"),
    );
  });
});
