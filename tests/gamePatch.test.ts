import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  gamePatchAddedPaths,
  mergeGamePatchFiles,
  parseGamePatchManifest,
  parseGamePatchPointer,
  resolveGamePatchPlan,
  versionMatchesBase,
} from "../src/gamePatch";
import type { GamePackageFile } from "../src/gamePackage";
import { PLATFORM_GAMES } from "../src/platform/gameCatalog";

const pointerPayload = {
  schemaVersion: 1,
  kind: "patch",
  productSegment: "crossingvoid",
  platform: "Windows",
  version: "0.6.2",
  baseVersion: "0.6",
  channel: "Stable",
  generatedAt: "2026-10-27T15:38:08+08:00",
  manifestUrl:
    "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-Patch-V0.6.2/patch.json",
  packageUrl:
    "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-Patch-V0.6.2/crossingvoid-Windows-Patch-0.6.2.zip",
  packageSizeBytes: 71432581,
  packageSha256:
    "3243cd54c28e0d3a9b34b986a0e9db4d058bb7ee64e219bc4e723f16d83d4631",
};

const patchFiles = [
  {
    path: "CrossingVoid.exe",
    sizeBytes: 444928,
    sha256: "8fd9233aa2cd2b304ce5fe94c4d7e4ad16787b50d8a62b108320fadb3d825ac1",
  },
  {
    path: "CrossingVoid/Binaries/Win64/CrossingVoid-Win64-Shipping.exe",
    sizeBytes: 167301632,
    sha256: "ddd676bae4a725fb5bd842415ebd17bc0c7435ef54935fdc65b8b7303dfa9517",
  },
  {
    path: "CrossingVoid/Content/Paks/pakchunk0-Windows_0_P.pak",
    sizeBytes: 373251,
    sha256: "f1eb9cd2d277a8a1a2f7bb7024287c5e38cd5e26e8b01a27a6b0f56eb18ad092",
  },
];

const manifestPayload = {
  schemaVersion: 1,
  kind: "patch",
  productSegment: "crossingvoid",
  platform: "Windows",
  version: "0.6.2",
  baseVersion: "0.6",
  channel: "Stable",
  files: patchFiles,
};

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const patchSource = readFileSync(resolve(process.cwd(), "src/gamePatch.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/game_patch.rs"), "utf8");

describe("parseGamePatchPointer", () => {
  it("reads the published pointer", () => {
    const pointer = parseGamePatchPointer(pointerPayload);
    expect(pointer).toBeTruthy();
    expect(pointer?.version).toBe("0.6.2");
    expect(pointer?.baseVersion).toBe("0.6");
    expect(pointer?.packageSizeBytes).toBe(71432581);
    expect(pointer?.packageSha256).toHaveLength(64);
  });

  it("rejects half a pointer instead of downloading something unknown", () => {
    expect(parseGamePatchPointer(null)).toBeNull();
    expect(parseGamePatchPointer({ ...pointerPayload, schemaVersion: 2 })).toBeNull();
    expect(parseGamePatchPointer({ ...pointerPayload, kind: "full" })).toBeNull();
    expect(parseGamePatchPointer({ ...pointerPayload, packageUrl: "ftp://x/y.zip" })).toBeNull();
    expect(parseGamePatchPointer({ ...pointerPayload, packageSizeBytes: 0 })).toBeNull();
    expect(parseGamePatchPointer({ ...pointerPayload, packageSha256: "abc" })).toBeNull();
    expect(parseGamePatchPointer({ ...pointerPayload, baseVersion: "" })).toBeNull();
  });
});

describe("parseGamePatchManifest", () => {
  it("reads the file list and keeps only valid rows", () => {
    const manifest = parseGamePatchManifest(manifestPayload, "0.6.2");
    expect(manifest?.files).toHaveLength(3);
    expect(manifest?.files[1].path).toContain("CrossingVoid-Win64-Shipping.exe");
    expect(manifest?.files[1].sizeBytes).toBe(167301632);
  });

  it("rejects a list from another version", () => {
    expect(parseGamePatchManifest(manifestPayload, "0.6.1")).toBeNull();
  });

  it("drops malformed entries and duplicate paths", () => {
    const manifest = parseGamePatchManifest({
      ...manifestPayload,
      files: [
        ...patchFiles,
        { path: "CrossingVoid.exe", sizeBytes: 1, sha256: "0".repeat(64) },
        { path: "bad.bin", sizeBytes: 0, sha256: "0".repeat(64) },
        { path: "", sizeBytes: 1, sha256: "0".repeat(64) },
      ],
    });
    expect(manifest?.files).toHaveLength(3);
    expect(manifest?.files[0].sizeBytes).toBe(444928);
  });

  it("rejects a manifest with no usable files", () => {
    expect(parseGamePatchManifest({ ...manifestPayload, files: [] })).toBeNull();
    expect(
      parseGamePatchManifest({
        ...manifestPayload,
        files: [{ path: "a", sizeBytes: 0, sha256: "0".repeat(64) }],
      }),
    ).toBeNull();
  });
});

describe("versionMatchesBase", () => {
  it("matches the two-part base version the publisher writes", () => {
    expect(versionMatchesBase("0.6.0", "0.6")).toBe(true);
    expect(versionMatchesBase("0.6", "0.6")).toBe(true);
    expect(versionMatchesBase("0.6.1", "0.6")).toBe(true);
    expect(versionMatchesBase("v0.6.0", "0.6")).toBe(true);
    // 数字段必须逐个相等，不能拿字符串前缀糊弄
    expect(versionMatchesBase("0.60.0", "0.6")).toBe(false);
    expect(versionMatchesBase("0.5.14", "0.6")).toBe(false);
    expect(versionMatchesBase("", "0.6")).toBe(false);
  });
});

describe("resolveGamePatchPlan", () => {
  const base = {
    pointer: parseGamePatchPointer(pointerPayload),
    localVersion: "0.6.0",
    productSegment: "crossingvoid",
    platform: "Windows",
    channel: "stable",
  };

  it("applies a newer patch whose base matches the local version", () => {
    expect(resolveGamePatchPlan(base)).toEqual({ applies: true, reason: "ok" });
  });

  it("does not apply when the local version is not on the base", () => {
    expect(resolveGamePatchPlan({ ...base, localVersion: "0.5.14" }).reason).toBe("base-mismatch");
    expect(resolveGamePatchPlan({ ...base, localVersion: "" }).reason).toBe("no-local-version");
  });

  it("does not apply the same version twice", () => {
    expect(resolveGamePatchPlan({ ...base, localVersion: "0.6.2" }).reason).toBe("not-newer");
  });

  it("rejects a patch for another product/platform/channel", () => {
    expect(resolveGamePatchPlan({ ...base, productSegment: "fantasyproject" }).reason).toBe(
      "product-mismatch",
    );
    expect(resolveGamePatchPlan({ ...base, platform: "Android" }).reason).toBe("platform-mismatch");
    expect(resolveGamePatchPlan({ ...base, channel: "beta" }).reason).toBe("channel-mismatch");
  });

  it("treats a missing pointer as 'no patch'", () => {
    expect(resolveGamePatchPlan({ ...base, pointer: null }).reason).toBe("no-pointer");
  });
});

describe("mergeGamePatchFiles", () => {
  const baseFiles: GamePackageFile[] = [
    { path: "CrossingVoid.exe", sizeBytes: 10, sha256: "a".repeat(64) },
    { path: "CrossingVoid/Content/Paks/pakchunk0-Windows.pak", sizeBytes: 20, sha256: "b".repeat(64) },
  ];

  it("replaces changed paths and appends new ones without duplicating", () => {
    const merged = mergeGamePatchFiles(baseFiles, patchFiles);
    expect(merged).toHaveLength(4);
    expect(merged.find((file) => file.path === "CrossingVoid.exe")?.sizeBytes).toBe(444928);
    // 原有没在补丁里的文件必须保留
    expect(merged.some((file) => file.path.endsWith("pakchunk0-Windows.pak"))).toBe(true);
    expect(new Set(merged.map((file) => file.path.toLowerCase())).size).toBe(merged.length);
  });

  it("matches paths case-insensitively and with backslashes", () => {
    const merged = mergeGamePatchFiles(
      [{ path: "CrossingVoid\\Content\\Paks\\A.pak", sizeBytes: 1, sha256: "c".repeat(64) }],
      [{ path: "crossingvoid/content/paks/a.pak", sizeBytes: 2, sha256: "d".repeat(64) }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sizeBytes).toBe(2);
  });

  it("reports the paths the patch adds", () => {
    expect(gamePatchAddedPaths(baseFiles, patchFiles)).toEqual([
      "CrossingVoid/Binaries/Win64/CrossingVoid-Win64-Shipping.exe",
      "CrossingVoid/Content/Paks/pakchunk0-Windows_0_P.pak",
    ]);
  });
});

describe("launcher wiring", () => {
  it("configures the fixed patch pointer for the PC game only", () => {
    const pc = PLATFORM_GAMES.find((game) => game.id === "crossing-void");
    expect(pc?.gamePackage?.githubPatchPointerUrl).toBe(
      "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-Patch-Latest/patch-latest.json",
    );
    const fantasy = PLATFORM_GAMES.find((game) => game.id === "fantasy-kill");
    expect(fantasy?.gamePackage?.githubPatchPointerUrl).toBeUndefined();
  });

  it("prefers the patch in the primary action and falls back to the full update", () => {
    const action = appSource.slice(
      appSource.indexOf("async function handlePrimaryAction"),
      appSource.indexOf("async function checkForUpdates"),
    );
    expect(action).toContain("if (gamePatchAvailable.value)");
    expect(action).toContain("await applyGamePatch()");
    // 没有补丁时必须还能走原来的完整更新
    expect(action).toContain("updateDownloadPending.value = true");
  });

  it("checks the patch pointer without letting a GitHub failure break version checks", () => {
    const check = appSource.slice(
      appSource.indexOf("async function checkGameVersion"),
      appSource.indexOf("async function openLocalGameFiles"),
    );
    expect(appSource).toContain("githubPatchPointerUrl");
    expect(check).toContain("无法读取增量补丁指针");
    expect(check).toContain("resolveGamePatchPlan");
    // 补丁版本只在比完整清单新时才有资格当“远程版本”
    expect(check).toContain("candidatePatch");
  });

  it("applies the patch through Rust and merges the local state file", () => {
    const apply = appSource.slice(
      appSource.indexOf("async function applyGamePatch"),
      appSource.indexOf("async function resolveGamePatchBaseFiles"),
    );
    expect(apply).toContain('invoke<GamePatchSummary>("install_game_patch"');
    expect(apply).toContain("versionMarker: config.versionMarker");
    // 合并后的状态清单交给 Rust 写盘，和版本标记紧挨着
    expect(apply).toContain("mergeGamePatchFiles(baseFiles, manifest.files)");
    expect(apply).toContain("stateFiles: mergedFiles");
    expect(apply).toContain("productKey: config.productKey");
    expect(apply).toContain("await readLocalGameVersion()");
    // 补丁只发 GitHub：渠道关掉时不能偷偷走
    expect(apply).toContain('isDownloadChannelEnabled(downloadChannelStates.value, "github")');
  });

  it("does not let the shared progress listeners write download state during a patch", () => {
    expect(appSource).toContain("gamePatchApplying");
    const listener = appSource.slice(
      appSource.indexOf("async function ensureInstallProgressListener"),
      appSource.indexOf("async function ensureDownloadProgressListener"),
    );
    expect(listener).toContain("!gamePatchApplying.value");
    expect(listener).toContain("patchDownloading");
    expect(listener).toContain("patchApplying");
  });

  it("keeps the native side honest: part file, hash check, atomic replace, marker last", () => {
    expect(rustSource).toContain("fn apply_patch_package");
    expect(rustSource).toContain("part_path(&target)");
    expect(rustSource).toContain("calculate_file_sha256(&temporary)");
    expect(rustSource).toContain("replace_file_atomic(&temporary, &target)");
    // 版本标记必须是最后一步写（跳过函数定义那一处，只看 apply 里的调用）
    const applyStart = rustSource.indexOf("fn apply_patch_package");
    const stateWrite = rustSource.indexOf("write_state(install_dir, product_key, version, state_files)", applyStart);
    const markerWrite = rustSource.indexOf("write_version_marker(install_dir,", applyStart);
    expect(stateWrite).toBeGreaterThan(applyStart);
    expect(markerWrite).toBeGreaterThan(stateWrite);
    expect(rustSource.indexOf("replace_file_atomic(&temporary, &target)", applyStart)).toBeLessThan(
      stateWrite,
    );
    // 整包先校验 sha256
    expect(rustSource).toContain("补丁包 sha256 校验失败");
    // 包里多出来的 patch.json / Version.json 不能被写进游戏目录
    expect(rustSource).toContain("entries.get(&key)");
    expect(patchSource).toContain("GamePatchSummary");
  });
});
