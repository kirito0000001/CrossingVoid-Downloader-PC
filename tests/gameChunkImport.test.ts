import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("game chunk import", () => {
  it("offers the game chunk import action on the download settings page", () => {
    const downloadPageStart = appSource.indexOf("data-settings-page=\"download\"");
    const downloadPageEnd = appSource.indexOf("data-settings-page=\"game\"");
    const aboutPageStart = appSource.indexOf("data-settings-page=\"about\"");
    const developerPageStart = appSource.indexOf("data-settings-page=\"developer\"");
    const downloadPage = appSource.slice(downloadPageStart, downloadPageEnd);
    const aboutPage = appSource.slice(aboutPageStart, developerPageStart);

    expect(downloadPage).toContain("导入碎片");
    expect(downloadPage).toContain('@click="openGameChunkImportGuide"');
    expect(aboutPage).not.toContain("importGameChunks");
    expect(appSource).toContain("importGameChunks");
  });

  it("keeps a matching primary-style chunk button beside download until chunks are ready to install", () => {
    expect(appSource).toContain('v-if="showGameChunkImportAction"');
    expect(appSource).toContain('class="primary-action chunk-install-action"');
    expect(appSource).toContain('@click="openGameChunkImportGuide"');
    expect(appSource).toContain('launcherState.value !== "downloaded"');
    expect(appSource).toContain('!hasCompleteDownloadedArchive.value');
  });

  it("moves only the menu left while preserving the original button dimensions", () => {
    expect(appSource).toContain(":class=\"{ 'has-chunk-install': showGameChunkImportAction }\"");
    expect(appSource).toMatch(/\.dock-actions\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*59px 189px;/);
    expect(appSource).toMatch(/\.dock-actions\.has-chunk-install\s*\{[\s\S]*?grid-template-columns:\s*59px 189px 189px;/);
    expect(appSource).toMatch(/\.dock-actions\.has-chunk-install\s*~\s*\.tool-menu\s*\{[\s\S]*?right:\s*402px;/);
  });

  it("selects one folder and lets the native importer find chunks inside it", () => {
    const importSource = appSource.match(/async function importGameChunks\(\) \{[\s\S]*?\n\}/)?.[0];
    const folderSource = appSource.match(/async function chooseGameChunkFolder\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(importSource).toBeTruthy();
    expect(folderSource).toBeTruthy();
    expect(folderSource).toContain("directory: true");
    expect(folderSource).toContain("multiple: false");
    expect(importSource).toContain("sourcePaths: [selected]");
    expect(importSource).toContain("stopActiveDownloadBeforeChunkImport");
    expect(nativeSource).toContain("collect_imported_chunk_files");
  });

  it("keeps local chunk import available while launcher updating is required", () => {
    const disabledSource = appSource.slice(
      appSource.indexOf("const gameChunkImportDisabled"),
      appSource.indexOf("const downloadSourceDisabled"),
    );
    const importSource = appSource.match(/async function importGameChunks\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(disabledSource).not.toContain("launcherAccessLocked");
    expect(importSource).not.toContain("launcherAccessLocked");
    expect(appSource).toContain('@click="openGameChunkImportGuide"');
    expect(appSource).not.toContain('class="confirm-panel launcher-update-panel"');
  });

  it("shows an import guide with folder selection and four external download sources", () => {
    expect(appSource).toContain('v-if="showGameChunkImportGuide"');
    expect(appSource).toContain("游戏碎片是将完整游戏包拆分后的文件");
    expect(appSource).toContain("选择包含全部游戏碎片的文件夹");
    expect(appSource).toContain("https://qm.qq.com/q/Nrlo5pBLwY");
    expect(appSource).toContain("https://pan.baidu.com/s/1J5zcggAWiq0Ui47fSZ1P0Q?pwd=2333");
    expect(appSource).toContain("https://www.alipan.com/s/hGG6ZxsR6Y1");
    expect(appSource).toContain("https://www.123684.com/s/SQH4vd-OoPZ3");
    expect(appSource).toContain('openUrl(url)');
    expect(appSource).toContain(':disabled="!selectedChunkFolder || gameChunkImportPending"');
  });

  it("keeps the import guide readable and visually compact", () => {
    expect(appSource).toContain("获取游戏碎片");
    expect(appSource).toContain("选择碎片文件夹");
    expect(appSource).toMatch(/\.chunk-import-panel\s*\{[\s\S]*?min-height:\s*450px;/);
    expect(appSource).toMatch(/\.chunk-import-description[\s\S]*?font-size:\s*20px;/);
    expect(appSource).toMatch(/\.chunk-import-hint\s*\{[\s\S]*?font-size:\s*17px;/);
  });

  it("reports byte-level validation progress while imported chunks are hashed", () => {
    const importStart = nativeSource.indexOf("async fn import_game_chunks");
    const installStart = nativeSource.indexOf("async fn install_downloaded_game_archive", importStart);
    const importSource = nativeSource.slice(importStart, installStart);

    expect(importSource).toContain("app: AppHandle");
    expect(importSource).toContain("game-chunk-import-progress");
    expect(importSource).toContain("processed_bytes");
    expect(importSource).toContain("total_bytes");
    expect(appSource).toContain('listen<ChunkImportProgressEvent>("game-chunk-import-progress"');
  });

  it("clears the previous partial download only after selected chunks pass validation", () => {
    const importStart = nativeSource.indexOf("async fn import_game_chunks");
    const installStart = nativeSource.indexOf("async fn install_downloaded_game_archive", importStart);
    const importSource = nativeSource.slice(importStart, installStart);
    const verifyIndex = importSource.indexOf("calculate_file_sha256_with_progress");
    const clearIndex = importSource.indexOf("remove_download_artifacts");
    const copyIndex = importSource.indexOf("fs::copy");

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(verifyIndex);
    expect(copyIndex).toBeGreaterThan(clearIndex);
  });

  it("returns to the main page and explains installation failures", () => {
    const installSource = appSource.match(
      /async function installDownloadedGameArchive\(\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(installSource).toBeTruthy();
    expect(installSource).toContain("showSettings.value = false");
    expect(installSource).toContain('showCheckResult(`安装游戏失败：${formatUnknownError(error)}`)');
    expect(appSource).toContain('v-if="compactStatusLine || lastCheckMessage"');
    expect(appSource).toContain('lastCheckMessage || statusCopy');
  });

  it("copies only the manifest-verified chunks into the staged download directory", () => {
    expect(nativeSource).toContain("import_game_chunks");
    expect(nativeSource).toContain("Imported chunk is not part of the current manifest");
    expect(nativeSource).toContain("verify_sha256");
  });

  it("accepts both manifest chunk names and Github numeric aliases", () => {
    expect(nativeSource).toContain("resolve_imported_chunk");
    expect(nativeSource).toContain("github_chunk_index");
    expect(nativeSource).toContain('strip_prefix("CrossingVoid.")');
  });
});
