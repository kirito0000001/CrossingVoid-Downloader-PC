import { describe, expect, it } from "vitest";

import {
  importablePathsWithoutManifest,
  matchChunkSelection,
  parseGameChunkFragments,
  type GameChunkFileInspection,
  type GameChunkFragment,
} from "../src/gameChunkFragments";

const fragments: GameChunkFragment[] = [
  { fileName: "零境V0.6基础碎片001.zip", sizeBytes: 862273823, fileCount: 40 },
  { fileName: "零境V0.6基础碎片002.zip", sizeBytes: 846465935, fileCount: 75 },
  { fileName: "零境V0.6基础碎片003.zip", sizeBytes: 951699870, fileCount: 64 },
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
    expect(renamed?.fileName).toBe("零境V0.6基础碎片002.zip");
    expect(selection.importablePaths).toEqual(["C:\\碎片\\我改的名字.zip"]);
  });

  it("flags a downloaded-half package instead of importing it", () => {
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.6基础碎片001.zip", 123),
    ]);
    const row = selection.rows[0];
    expect(row.status).toBe("size-mismatch");
    expect(row.actualBytes).toBe(123);
    expect(selection.importablePaths).toEqual([]);
    expect(selection.allReady).toBe(false);
  });

  it("flags a file that is not a zip and leaves it out of the import", () => {
    const selection = matchChunkSelection(fragments, [
      inspection("零境V0.6基础碎片001.zip", 862273823, {
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
      inspection("零境V0.6基础碎片001.zip", 862273823),
    ]);
    expect(selection.rows.map((row) => row.status)).toEqual(["ready", "missing", "missing"]);
    expect(selection.readyCount).toBe(1);
    expect(selection.allReady).toBe(false);
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
