import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { appSource, launcherSource, launcherStyleSource } from "./helpers/launcherSources";

const nativeSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const packageSource = readFileSync(resolve(process.cwd(), "src-tauri/src/game_package.rs"), "utf8");
const toolMenuSource = readFileSync(
  resolve(process.cwd(), "src/components/LauncherToolMenu.vue"),
  "utf8",
);

describe("game chunk import", () => {
  it("offers the game chunk import action on the download settings page", () => {
    const downloadPageStart = launcherSource.indexOf("data-settings-page=\"download\"");
    const downloadPageEnd = launcherSource.indexOf("data-settings-page=\"game\"");
    const aboutPageStart = launcherSource.indexOf("data-settings-page=\"about\"");
    const developerPageStart = launcherSource.indexOf("data-settings-page=\"developer\"");
    const downloadPage = launcherSource.slice(downloadPageStart, downloadPageEnd);
    const aboutPage = launcherSource.slice(aboutPageStart, developerPageStart);

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
    expect(launcherStyleSource).toMatch(/\.dock-actions\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*59px 189px;/);
    expect(launcherStyleSource).toMatch(/\.dock-actions\.has-chunk-install\s*\{[\s\S]*?grid-template-columns:\s*59px 189px 189px;/);
    expect(appSource).toContain(':chunk-install-visible="showGameChunkImportAction"');
    expect(toolMenuSource).toMatch(/\.tool-menu\.has-chunk-install\s*\{[\s\S]*?right:\s*402px;/);
  });

  it("selects zip files and hands their paths to the native importer", () => {
    const importSource = appSource.match(/async function importGameChunks\(\) \{[\s\S]*?\n\}/)?.[0];
    const pickerSource = appSource.match(/async function chooseGameChunkFiles\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(importSource).toBeTruthy();
    expect(pickerSource).toBeTruthy();
    // 下载下来就是文件，直接多选；不再让玩家找文件夹
    expect(pickerSource).toContain("multiple: true");
    expect(pickerSource).toContain("directory: false");
    expect(pickerSource).toContain('extensions: ["zip"]');
    expect(appSource).toContain("async function addGameChunkFiles(");
    expect(importSource).toContain("const sources = chunkImportPaths.value;");
    expect(importSource).toContain("sources,");
    expect(importSource).toContain("files: manifest.files");
    expect(importSource).toContain("stopActiveDownloadBeforeChunkImport");
    expect(packageSource).toContain("pub fn import_package_files");
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

  it("shows the expected fragments from the network list and marks picked ones ready", () => {
    expect(appSource).toContain('v-if="showGameChunkImportGuide"');
    expect(appSource).toContain("本次需要的碎片");
    expect(appSource).toContain(':class="`is-${row.status}`"');
    expect(appSource).toContain("chunkStatusLabel(row)");
    expect(appSource).toContain("chunkUnexpectedLabel(file)");
    expect(appSource).toContain("chunkSelection.readyCount");
    expect(appSource).toContain(':disabled="!chunkCanStartImport"');
    // 清单从 latest.json 的 fragmentsUrl 读，版本不一致直接判无效
    expect(appSource).toContain("pointer.fragmentsUrl");
    expect(appSource).toContain("parseGameChunkFragments(");
    expect(launcherSource).toContain("https://qm.qq.com/q/Nrlo5pBLwY");
    expect(launcherSource).toContain("https://pan.baidu.com/s/1J5zcggAWiq0Ui47fSZ1P0Q?pwd=2333");
    expect(launcherSource).toContain("https://www.alipan.com/s/hGG6ZxsR6Y1");
    expect(launcherSource).toContain("https://www.123684.com/s/SQH4vd-OoPZ3");
    expect(appSource).toContain('openUrl(url)');
  });

  it("keeps the import guide readable and visually compact", () => {
    expect(appSource).toContain("获取游戏碎片");
    expect(appSource).toContain("选择压缩包");
    expect(launcherStyleSource).toMatch(/\.chunk-import-panel\s*\{[\s\S]*?min-height:\s*450px;/);
    expect(launcherStyleSource).toMatch(/\.chunk-import-description[\s\S]*?font-size:\s*20px;/);
    expect(launcherStyleSource).toMatch(/\.chunk-import-hint\s*\{[\s\S]*?font-size:\s*17px;/);
  });

  it("reuses the download progress event instead of opening a second progress channel", () => {
    // 导入和下载共用同一把尺子（目标位置的文件 size + sha256 对得上清单），
    // 所以也共用同一条进度事件 —— 前端不必为导入单开一套显示。
    expect(packageSource).toContain("emit_game_package_progress");
    expect(packageSource).not.toContain("game-chunk-import-progress");
    expect(appSource).not.toContain("game-chunk-import-progress");
    expect(appSource).toContain("const importingFragments = gameChunkImportPending.value;");
    expect(appSource).toContain("正在导入碎片");
  });

  it("registers the progress listeners before importing and before install verification", () => {
    // 导入不经过下载，没人替它注册监听器；漏挂的后果就是进度条一直 0、最后直接完成。
    const importSource = appSource.match(/async function importGameChunks\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    const finalizeSource =
      appSource.match(/async function finalizeGamePackageInstall\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(importSource).toContain("await ensureDownloadProgressListener();");
    expect(finalizeSource).toContain("await ensureDownloadProgressListener();");
    // 导入顶替“下载”那一段，百分比按 90 的尺子缩放，导入结束不会从 100% 掉回 90%。
    expect(appSource).toContain("((payload.percent || 0) * DOWNLOAD_PROGRESS_SHARE) / 100");
  });

  it("writes every fragment through a .part file and only keeps it after the hash matches", () => {
    const writeStart = packageSource.indexOf("fn import_write_source");
    const writeEnd = packageSource.indexOf("fn import_copy_file", writeStart);
    const writeSource = packageSource.slice(writeStart, writeEnd);

    expect(writeStart).toBeGreaterThan(-1);
    expect(writeSource).toContain("part_path(target)");
    // 校验不通过就删掉 .part、记一笔 mismatched，正式位置一个字节都不许落
    expect(packageSource).toContain("replace_file_atomic(&temporary, &target)");
    expect(packageSource).toContain("mismatched.push(entry.path.clone())");
    expect(packageSource).toContain("remove_file_if_exists(&temporary)?");
  });

  it("skips files that already match the manifest so importing twice is cheap", () => {
    expect(packageSource).toContain("if file_matches_entry(&target, entry) {");
    // 已经对上的直接算进度、不重拷
    expect(packageSource).toContain("continue;");
  });

  it("keeps importing when one archive is broken and reports the bad package", () => {
    // 网盘下坏一个包不该让另外两个包白导：坏包记进 brokenArchives，包内文件按缺失算；
    // 但落盘失败（磁盘满 / 没权限）和取消仍然整单停，不能当成“源坏了”咽掉。
    expect(packageSource).toContain("pub broken_archives: Vec<String>");
    expect(packageSource).toContain("fn archive_label");
    expect(packageSource).toContain("broken.push(format!(");
    expect(packageSource).toContain("Err(ImportWriteError::Source(message)) => {");
    expect(packageSource).toContain("| Err(ImportWriteError::Target(message)) => return Err(message)");
    expect(packageSource).toContain("broken_archive_paths.contains(archive_path)");
    expect(appSource).toContain("result.brokenArchives ?? []");
    expect(appSource).toContain("个压缩包打不开");
  });

  it("matches fragments by manifest path so archives may be renamed", () => {
    // 压缩包里的条目名就是清单里的相对路径：包的**文件名**随便改都能导
    expect(packageSource).toContain("fn normalize_archive_entry_name");
    expect(packageSource).toContain("safe_relative_path(&name)");
    expect(packageSource).toContain(".or_else(|| archived.get(&entry.path))");
    // 散件在选中的文件夹下面多套一层也能找到
    expect(packageSource).toContain("fn import_resolve_root");
    expect(packageSource).toContain("IMPORT_ROOT_PROBE_DEPTH");
  });

  it("refuses to take the install directory itself as the fragment source", () => {
    expect(packageSource).toContain("碎片来源不能是游戏安装目录本身");
    expect(packageSource).toContain("chosen.starts_with(&install_root)");
  });

  it("retires the old fixed-name chunk importer", () => {
    // 「原本的分配已经彻底不用了」：名字对不上就导不进来那套（含 GitHub 数字别名）整体作废
    expect(packageSource).not.toContain("import_game_chunks");
    expect(nativeSource).not.toContain("resolve_imported_chunk");
    expect(nativeSource).not.toContain("collect_imported_chunk_files");
    expect(appSource).not.toContain('invoke<{ importedChunks');
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
});
