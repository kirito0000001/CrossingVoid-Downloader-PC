import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GITHUB_FRAGMENTS_TAG,
  githubFragmentsManifestUrl,
  importablePathsWithoutManifest,
  matchChunkSelection,
  parseGameChunkFragments,
  resolveGameChunkFragmentsSource,
  type GameChunkFileInspection,
  type GameChunkFragment,
} from "../src/gameChunkFragments";
import { PLATFORM_GAMES } from "../src/platform/gameCatalog";

const fragments: GameChunkFragment[] = [
  { fileName: "零境V0.6PC基础碎片001.zip", sizeBytes: 862273823, fileCount: 40 },
  { fileName: "零境V0.6PC基础碎片002.zip", sizeBytes: 846465935, fileCount: 75 },
  { fileName: "零境V0.6PC基础碎片003.zip", sizeBytes: 951699870, fileCount: 64 },
];

function inspection(
  fileName: string,
  sizeBytes: number,
  extra: Partial<GameChunkFileInspection> = {},
): GameChunkFileInspection {
  return {
    path: `C:\\碎片\\${fileName}`,
    fileName,
    sizeBytes,
    isZip: true,
    entryCount: 0,
    ...extra,
  };
}

describe("碎片清单来源（下载站优先，GitHub 兜底）", () => {
  const downloadStation = "https://dl.crossingvoid.top/fragments/0.6.0.json";
  const github = "https://github.com/kirito0000001/fantasy-project-packages/releases/download/fragments-latest/fragments.json";

  it("下载站给了 fragmentsUrl 就用下载站，并带上它的版本", () => {
    const source = resolveGameChunkFragmentsSource({
      pointer: { version: "0.6.0", fragmentsUrl: ` ${downloadStation} ` },
      githubFallbackUrl: github,
    });
    expect(source).toEqual({
      url: downloadStation,
      expectedVersion: "0.6.0",
      source: "download-station",
    });
  });

  it("下载站有版本但没有 fragmentsUrl 时回退到 GitHub 地址", () => {
    const source = resolveGameChunkFragmentsSource({
      pointer: { version: "V0.1.0" },
      githubFallbackUrl: github,
    });
    expect(source).toEqual({ url: github, expectedVersion: "V0.1.0", source: "github" });
  });

  it("下载站整份 latest.json 都拿不到时同样回退（幻杀就是这种）", () => {
    const source = resolveGameChunkFragmentsSource({
      pointer: null,
      githubFallbackUrl: github,
    });
    // 没有版本指针就没有版本可比，expectedVersion 必须留空 —— 否则会被判成"不是这一版"
    expect(source).toEqual({ url: github, source: "github" });
    expect(source?.expectedVersion).toBeUndefined();
  });

  it("两个来源都没有就返回 null，退化成直接选压缩包", () => {
    expect(resolveGameChunkFragmentsSource({ pointer: null, githubFallbackUrl: null })).toBeNull();
    expect(
      resolveGameChunkFragmentsSource({ pointer: { fragmentsUrl: "ftp://x/y.json" }, githubFallbackUrl: "" }),
    ).toBeNull();
    expect(
      resolveGameChunkFragmentsSource({ pointer: { version: "1.0.0" }, githubFallbackUrl: "   " }),
    ).toBeNull();
  });

  it("兜底地址按固定 tag 与附件名拼，非法仓库名返回 null", () => {
    expect(GITHUB_FRAGMENTS_TAG).toBe("fragments-latest");
    expect(githubFragmentsManifestUrl("kirito0000001/CrossingVoid")).toBe(
      "https://github.com/kirito0000001/CrossingVoid/releases/download/fragments-latest/fragments.json",
    );
    expect(githubFragmentsManifestUrl(" /kirito0000001/CrossingVoid/ ")).toBe(
      "https://github.com/kirito0000001/CrossingVoid/releases/download/fragments-latest/fragments.json",
    );
    expect(githubFragmentsManifestUrl(null)).toBeNull();
    expect(githubFragmentsManifestUrl("CrossingVoid")).toBeNull();
    expect(githubFragmentsManifestUrl("a/b/c")).toBeNull();
  });

  it("幻杀与零境配的是发布侧约定的那两个地址，且与各自 GitHub 仓库对得上", () => {
    const expected: Record<string, string> = {
      "fantasy-kill":
        "https://github.com/kirito0000001/fantasy-project-packages/releases/download/fragments-latest/fragments.json",
      "crossing-void":
        "https://github.com/kirito0000001/CrossingVoid/releases/download/fragments-latest/fragments.json",
    };
    for (const [gameId, url] of Object.entries(expected)) {
      const game = PLATFORM_GAMES.find((item) => item.id === gameId);
      expect(game?.gamePackage?.githubFragmentsUrl).toBe(url);
      // 兜底地址必须指向这一档自己的 GitHub 仓库（改仓库时两处要一起改）
      expect(githubFragmentsManifestUrl(game?.runtime?.github?.repository)).toBe(url);
    }
    // 没有 GitHub 备用源的档位不该配兜底
    expect(PLATFORM_GAMES.find((item) => item.id === "naruto-bp")?.gamePackage?.githubFragmentsUrl)
      .toBeUndefined();
  });

  it("App.vue 先把下载站当首选、再兜底，且不发下载站的档位不白跑一次 404", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
    const loader = appSource.slice(
      appSource.indexOf("async function loadGameChunkFragments"),
      appSource.indexOf("async function chooseGameChunkFiles"),
    );
    expect(loader).toContain("gamePackageSources(config).includes");
    expect(loader).toContain("resolveGameChunkFragmentsSource");
    expect(loader.indexOf("gamePackageSources(config)")).toBeLessThan(
      loader.indexOf("resolveGameChunkFragmentsSource"),
    );
    // 两条来源都拿不到时必须退化成"直接选压缩包"，不能把导入堵死
    expect(loader).toContain("直接选择压缩包即可");
  });
});

describe("parseGameChunkFragments", () => {
  it("reads the published fragment list", () => {
    const parsed = parseGameChunkFragments(
      {
        schemaVersion: 1,
        version: "0.6.0",
        totalBytes: 2660439628,
        fragments: fragments.map((item) => ({ ...item })),
      },
      "0.6.0",
    );
    expect(parsed).toBeTruthy();
    expect(parsed?.fragments).toHaveLength(3);
    expect(parsed?.totalBytes).toBe(2660439628);
    expect(parsed?.fragments[0].fileCount).toBe(40);
  });

  it("rejects a list from another version", () => {
    const parsed = parseGameChunkFragments(
      { schemaVersion: 1, version: "0.6.1", fragments },
      "0.6.0",
    );
    expect(parsed).toBeNull();
  });

  it("rejects malformed payloads instead of showing half a list", () => {
    expect(parseGameChunkFragments(null)).toBeNull();
    expect(parseGameChunkFragments({ schemaVersion: 2, version: "0.6.0", fragments })).toBeNull();
    expect(parseGameChunkFragments({ schemaVersion: 1, version: "", fragments })).toBeNull();
    expect(
      parseGameChunkFragments({ schemaVersion: 1, version: "0.6.0", fragments: [] }),
    ).toBeNull();
    // 单条缺字段只丢那一条；全丢光就整份无效
    expect(
      parseGameChunkFragments({
        schemaVersion: 1,
        version: "0.6.0",
        fragments: [{ fileName: "a.zip", sizeBytes: 0, fileCount: 1 }],
      }),
    ).toBeNull();
  });

  it("falls back to summing fragment sizes when totalBytes is missing", () => {
    const parsed = parseGameChunkFragments({ schemaVersion: 1, version: "0.6.0", fragments });
    expect(parsed?.totalBytes).toBe(862273823 + 846465935 + 951699870);
  });
});

describe("matchChunkSelection", () => {
  it("marks every package ready when name and size both match", () => {
    const selection = matchChunkSelection(
      fragments,
      fragments.map((item) => inspection(item.fileName, item.sizeBytes)),
    );
    expect(selection.rows.map((row) => row.status)).toEqual(["ready", "ready", "ready"]);
    expect(selection.readyCount).toBe(3);
    expect(selection.allReady).toBe(true);
    expect(selection.importablePaths).toHaveLength(3);
    expect(selection.unexpected).toHaveLength(0);
  });

  it("still accepts a renamed package when its size is unique", () => {
    // 导入器只看条目名，包名随便改都能导 —— 界面不该比后端更严格
    const selection = matchChunkSelection(fragments, [
      inspection("我改的名字.zip", 846465935),
    ]);
    const renamed = selection.rows.find((row) => row.status === "renamed");
    expect(renamed?.fileName).toBe("零境V0.6PC基础碎片002.zip");
    expect(selection.importablePaths).toEqual(["C:\\碎片\\我改的名字.zip"]);
  });

  it("flags a downloaded-half package instead of importing it", () => {
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.6PC基础碎片001.zip", 123),
    ]);
    const row = selection.rows[0];
    expect(row.status).toBe("size-mismatch");
    expect(row.actualBytes).toBe(123);
    expect(selection.importablePaths).toEqual([]);
    expect(selection.allReady).toBe(false);
  });

  it("flags a file that is not a zip and leaves it out of the import", () => {
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.6PC基础碎片001.zip", 862273823, {
        isZip: false,
        error: "不是有效的 zip",
      }),
    ]);
    expect(selection.rows[0].status).toBe("invalid");
    expect(selection.importablePaths).toEqual([]);
  });

  it("lists a selected file that is not in this version's list", () => {
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.5基础碎片001.zip", 111),
    ]);
    expect(selection.unexpected).toHaveLength(1);
    expect(selection.rows.every((row) => row.status === "missing")).toBe(true);
  });

  it("keeps the missing rows visible so the player knows what to download", () => {
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.6PC基础碎片001.zip", 862273823),
    ]);
    expect(selection.rows.map((row) => row.status)).toEqual(["ready", "missing", "missing"]);
    expect(selection.readyCount).toBe(1);
    expect(selection.allReady).toBe(false);
  });

  it("still takes packages downloaded before the PC re-release by their unique size", () => {
    // 0.6.0 重发只把外层名从「零境V0.6基础碎片」改成「零境V0.6PC基础碎片」，
    // 包内条目名和字节都没动：玩家手里的旧包不该被逼着重下 2.5GB。
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.6基础碎片001.zip", 862273823),
      inspection("零境V0.6基础碎片002.zip", 846465935),
      inspection("零境V0.6基础碎片003.zip", 951699870),
    ]);
    expect(selection.rows.map((row) => row.status)).toEqual(["renamed", "renamed", "renamed"]);
    expect(selection.readyCount).toBe(3);
    expect(selection.allReady).toBe(true);
    expect(selection.unexpected).toHaveLength(0);
    expect(selection.importablePaths).toHaveLength(3);
  });

  it("does not guess when two packages share the same size", () => {
    const twins: GameChunkFragment[] = [
      { fileName: "a.zip", sizeBytes: 100, fileCount: 1 },
      { fileName: "b.zip", sizeBytes: 100, fileCount: 2 },
    ];
    const selection = matchChunkSelection(twins, [inspection("改过.zip", 100)]);
    expect(selection.rows.every((row) => row.status === "missing")).toBe(true);
    expect(selection.unexpected).toHaveLength(1);
  });
});

describe("importablePathsWithoutManifest", () => {
  it("falls back to every openable zip when no list is available", () => {
    const paths = importablePathsWithoutManifest([
      inspection("a.zip", 1),
      inspection("b.zip", 2, { isZip: false, error: "坏了" }),
    ]);
    expect(paths).toEqual(["C:\\碎片\\a.zip"]);
  });
});
