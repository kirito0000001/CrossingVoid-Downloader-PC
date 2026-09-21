import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GAME_PACKAGE_CORE_VERSION,
  GamePackageError,
  assertNoGamePackageDowngrade,
  buildGamePackagePlan,
  buildGamePackageUrlCandidates,
  compareGamePackageVersions,
  describeGamePackageError,
  githubGameAssetName,
  githubGameReleaseBaseUrl,
  githubGameReleaseTag,
  githubGameManifestUrl,
  pickGitHubGameRelease,
  gamePackageManifestUrl,
  isSafeGamePackagePath,
  officialGamePackageFileUrl,
  parseGamePackageManifest,
  parseGamePackageState,
  parseLatestPointer,
  withCacheBuster,
  type GamePackageFile,
  type GamePackageManifest,
} from "../src/gamePackage";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function file(path: string, content: string): GamePackageFile {
  return {
    path,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

const exe = file("CrossingVoid.exe", "exe-bytes");
const pak = file("CrossingVoid/Content/Paks/pakchunk0-Windows.ucas", "pak-bytes");
const versionMarker = file("CrossingVoid.version.json", '{"version":"0.5.14"}');

function manifestFixture(overrides: Partial<GamePackageManifest> = {}): GamePackageManifest {
  return {
    schemaVersion: 1,
    productKey: "crossingvoid-game",
    runtime: "Windows",
    version: "0.5.14",
    channel: "stable",
    baseUrl: "https://dl.crossingvoid.top/games/crossingvoid/0.5.14/",
    generatedAt: "2026-09-20T03:03:47.0000000+08:00",
    files: [exe, pak, versionMarker],
    patches: [],
    ...overrides,
  };
}

const expectation = { productKey: "crossingvoid-game", runtime: "Windows", channel: "stable" } as const;

describe("game package manifest", () => {
  it("parses a v1 manifest that matches the published shape", () => {
    const parsed = parseGamePackageManifest(manifestFixture(), expectation);
    expect(parsed.version).toBe("0.5.14");
    expect(parsed.files).toHaveLength(3);
    expect(parsed.baseUrl.endsWith("/")).toBe(true);
  });

  it("normalizes a baseUrl that is missing its trailing slash", () => {
    const parsed = parseGamePackageManifest(
      manifestFixture({ baseUrl: "https://dl.crossingvoid.top/games/crossingvoid/0.5.14" }),
      expectation,
    );
    expect(parsed.baseUrl).toBe("https://dl.crossingvoid.top/games/crossingvoid/0.5.14/");
  });

  it("rejects the legacy v2 manifest instead of treating it as no update", () => {
    expect(() =>
      parseGamePackageManifest({ ...manifestFixture(), schemaVersion: 2 }, expectation),
    ).toThrowError(/不受支持/);
    try {
      parseGamePackageManifest({ ...manifestFixture(), schemaVersion: 2 }, expectation);
    } catch (error) {
      expect((error as GamePackageError).code).toBe("manifest-unsupported");
    }
  });

  it("rejects a manifest for another game", () => {
    try {
      parseGamePackageManifest(
        manifestFixture({ productKey: "fantasyproject-game" }),
        expectation,
      );
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as GamePackageError).code).toBe("product-mismatch");
    }
  });

  it("rejects unsafe paths, bad hashes and duplicated entries", () => {
    const unsafe = manifestFixture({
      files: [{ path: "../escape.exe", sizeBytes: 1, sha256: "a".repeat(64) }],
    });
    expect(() => parseGamePackageManifest(unsafe, expectation)).toThrowError(/路径不安全/);

    const absolute = manifestFixture({
      files: [{ path: "C:/Windows/system32/evil.dll", sizeBytes: 1, sha256: "a".repeat(64) }],
    });
    expect(() => parseGamePackageManifest(absolute, expectation)).toThrowError(/路径不安全/);

    const badHash = manifestFixture({
      files: [{ path: "a.bin", sizeBytes: 1, sha256: "XYZ" }],
    });
    expect(() => parseGamePackageManifest(badHash, expectation)).toThrowError(/sha256/);

    const duplicated = manifestFixture({ files: [exe, exe] });
    expect(() => parseGamePackageManifest(duplicated, expectation)).toThrowError(/重复/);
  });

  it("keeps the ignore-patches contract (empty patches must not fail)", () => {
    const parsed = parseGamePackageManifest(
      { ...manifestFixture(), patches: [] },
      expectation,
    );
    expect(parsed.patches).toEqual([]);
  });

  it("treats path safety the same way the Rust side does", () => {
    expect(isSafeGamePackagePath("CrossingVoid/Content/Paks/global.ucas")).toBe(true);
    expect(isSafeGamePackagePath("CrossingVoid.exe")).toBe(true);
    expect(isSafeGamePackagePath("../escape.txt")).toBe(false);
    expect(isSafeGamePackagePath("/absolute.txt")).toBe(false);
    expect(isSafeGamePackagePath("C:/drive.txt")).toBe(false);
    expect(isSafeGamePackagePath("bad<name>.txt")).toBe(false);
    expect(isSafeGamePackagePath("")).toBe(false);
  });
});

describe("latest pointer", () => {
  it("parses the pointer that the download site really serves", () => {
    const pointer = parseLatestPointer({
      schemaVersion: 1,
      productSegment: "crossingvoid",
      version: "0.5.14",
      manifestUrl: "https://dl.crossingvoid.top/games/crossingvoid/manifests/0.5.14.json",
      generatedAt: "2026-09-20T12:33:10Z",
    });
    expect(pointer.version).toBe("0.5.14");
    expect(gamePackageManifestUrl("crossingvoid")).toBe(
      "https://dl.crossingvoid.top/games/crossingvoid/latest.json",
    );
    expect(withCacheBuster("https://x/y.json", 42)).toBe("https://x/y.json?t=42");
  });

  it("rejects a pointer without a usable manifest url", () => {
    expect(() =>
      parseLatestPointer({ schemaVersion: 1, productSegment: "crossingvoid", version: "1" }),
    ).toThrowError(/必要字段/);
  });
});

describe("download plan", () => {
  it("downloads only the files whose sha256 changed", () => {
    const localState = [exe, { ...pak, sha256: "b".repeat(64) }, versionMarker];
    const plan = buildGamePackagePlan(
      parseGamePackageManifest(manifestFixture(), expectation),
      localState,
      [exe.path, pak.path, versionMarker.path],
    );

    expect(plan.download.map((entry) => entry.path)).toEqual([pak.path]);
    expect(plan.keep).toEqual([exe.path, versionMarker.path]);
    expect(plan.prune).toEqual([]);
    expect(plan.totalBytes).toBe(pak.sizeBytes);
  });

  it("prunes files that the new manifest no longer lists", () => {
    const stalePath = "CrossingVoid/Content/Paks/pakchunk9-Windows.ucas";
    const plan = buildGamePackagePlan(
      parseGamePackageManifest(manifestFixture(), expectation),
      [exe, pak, versionMarker],
      [exe.path, pak.path, versionMarker.path, stalePath],
    );
    expect(plan.prune).toEqual([stalePath]);
    expect(plan.download).toEqual([]);
    expect(plan.totalBytes).toBe(0);
  });

  it("treats a missing local state as 'everything must be downloaded'", () => {
    const plan = buildGamePackagePlan(
      parseGamePackageManifest(manifestFixture(), expectation),
      null,
    );
    expect(plan.download).toHaveLength(3);
    expect(plan.keep).toEqual([]);
    expect(plan.totalBytes).toBe(exe.sizeBytes + pak.sizeBytes + versionMarker.sizeBytes);
  });

  it("compares paths case-insensitively so Windows installs are not re-downloaded", () => {
    const lowered = { ...exe, path: "crossingvoid.exe" };
    const plan = buildGamePackagePlan(
      parseGamePackageManifest(manifestFixture(), expectation),
      [lowered, pak, versionMarker],
      [],
    );
    expect(plan.download).toEqual([]);
    expect(plan.keep).toHaveLength(3);
  });
});

describe("local state parsing", () => {
  it("reads the published state shape", () => {
    const state = parseGamePackageState({
      schemaVersion: 1,
      productKey: "crossingvoid-game",
      version: "0.5.14",
      files: [exe, pak],
    });
    expect(state?.version).toBe("0.5.14");
    expect(state?.files).toHaveLength(2);
  });

  it("still reads the legacy files-only shape and drops broken entries", () => {
    const legacy = parseGamePackageState({
      files: [
        { path: "a.bin", sizeBytes: 3, sha256: "a".repeat(64) },
        { path: "../escape.bin", sizeBytes: 3, sha256: "b".repeat(64) },
      ],
    });
    expect(legacy?.files).toHaveLength(1);
    expect(legacy?.files[0].path).toBe("a.bin");
    expect(parseGamePackageState("not-an-object")).toBeNull();
  });
});

describe("versions and errors", () => {
  it("compares versions like the launcher does", () => {
    expect(compareGamePackageVersions("0.5.14", "0.5.13")).toBeGreaterThan(0);
    expect(compareGamePackageVersions("v0.5.14", "0.5.14")).toBe(0);
    expect(compareGamePackageVersions("0.5.14.1", "0.5.14")).toBeGreaterThan(0);
  });

  it("refuses to silently downgrade an installed game", () => {
    expect(() =>
      assertNoGamePackageDowngrade(
        parseGamePackageManifest(manifestFixture({ version: "0.5.13" }), expectation),
        "0.5.14",
      ),
    ).toThrowError(/低于本地版本/);
    expect(() =>
      assertNoGamePackageDowngrade(
        parseGamePackageManifest(manifestFixture(), expectation),
        "0.5.14",
      ),
    ).not.toThrow();
  });

  it("maps error codes to player-facing Chinese text", () => {
    expect(describeGamePackageError(new GamePackageError("version-retired", "x"))).toContain(
      "已下线",
    );
    expect(describeGamePackageError(new GamePackageError("disk-full", "x"))).toContain("空间不足");
    expect(describeGamePackageError(new Error("boom"))).toBe("boom");
  });
});

describe("shared core guard", () => {
  it("maps file paths to the GitHub release asset names the upload side uses", () => {
    expect(githubGameAssetName("CrossingVoid.exe")).toBe("CrossingVoid.exe");
    expect(githubGameAssetName("CrossingVoid/Binaries/Win64/CrossingVoid-Win64-Shipping.exe")).toBe(
      "CrossingVoid__Binaries__Win64__CrossingVoid-Win64-Shipping.exe",
    );
    expect(githubGameAssetName("CrossingVoid/Content/Movies/Login_1_Low.mp4")).toBe(
      "CrossingVoid__Content__Movies__Login_1_Low.mp4",
    );
    // 反斜杠、开头斜杠、多余空段都要吃掉，避免两端拼出不同的附件名。
    expect(githubGameAssetName("/CrossingVoid\\Content//Paks/global.ucas")).toBe(
      "CrossingVoid__Content__Paks__global.ucas",
    );
  });

  it("builds the release tag and download base url", () => {
    expect(githubGameReleaseTag("PC", "0.5.14")).toBe("PC-V0.5.14");
    expect(githubGameReleaseTag("Android", "V0.5.14")).toBe("Android-V0.5.14");
    expect(githubGameReleaseBaseUrl("kirito0000001/CrossingVoid", "PC-V0.5.14")).toBe(
      "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-V0.5.14/",
    );
    expect(githubGameManifestUrl("kirito0000001/CrossingVoid", "PC-V0.5.14")).toBe(
      "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-V0.5.14/manifest.json",
    );
  });

  it("picks the release that carries the manifest for this platform", () => {
    // 顺序按 GitHub Releases API 的真实返回：最新的在前（实测如此）。
    const releases = [
      {
        tag_name: "PC-V0.5.14",
        assets: [{ id: 3, name: "manifest.json" }, { id: 4, name: "CrossingVoid.exe" }],
      },
      {
        tag_name: "Android-V0.5.14",
        assets: [{ id: 1, name: "manifest.json" }],
      },
      {
        tag_name: "PC-V0.5.13",
        assets: [{ id: 2, name: "manifest.json" }],
      },
      {
        tag_name: "PC-V0.5.15",
        draft: true,
        assets: [{ id: 5, name: "manifest.json" }],
      },
    ];

    // 取第一条匹配的非草稿 release（顺序来自 API，新的在前）。
    expect(pickGitHubGameRelease(releases, { tagPrefix: "PC-V" })?.tag).toBe("PC-V0.5.14");
    expect(pickGitHubGameRelease(releases, { tagPrefix: "Android-V" })?.tag).toBe("Android-V0.5.14");

    // 预发布默认跳过；显式放行才会用它。
    const prereleaseFirst = [
      {
        tag_name: "PC-V0.5.16",
        prerelease: true,
        assets: [{ id: 6, name: "manifest.json" }],
      },
      { tag_name: "PC-V0.5.14", assets: [{ id: 3, name: "manifest.json" }] },
    ];
    expect(pickGitHubGameRelease(prereleaseFirst, { tagPrefix: "PC-V" })?.tag).toBe("PC-V0.5.14");
    expect(
      pickGitHubGameRelease(prereleaseFirst, { tagPrefix: "PC-V", allowPrerelease: true })?.tag,
    ).toBe("PC-V0.5.16");

    // 没有清单附件的平台直接判空，而不是拿一条残的凑数。
    expect(pickGitHubGameRelease(releases, { tagPrefix: "Naruto-V" })).toBeNull();
    expect(
      pickGitHubGameRelease([{ tag_name: "PC-V0.5.14", assets: [{ id: 1, name: "other.json" }] }], {
        tagPrefix: "PC-V",
      }),
    ).toBeNull();
  });

  it("orders per-file candidates by the preferred source and keeps the other as fallback", () => {
    const options = {
      path: "CrossingVoid/Content/Paks/pakchunk0-Windows.ucas",
      officialBaseUrl: "https://dl.crossingvoid.top/games/crossingvoid/0.5.14/",
      githubReleaseBaseUrl: "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-V0.5.14/",
    } as const;

    const officialFirst = buildGamePackageUrlCandidates({ ...options, preferred: "official" });
    expect(officialFirst).toEqual([
      "https://dl.crossingvoid.top/games/crossingvoid/0.5.14/CrossingVoid/Content/Paks/pakchunk0-Windows.ucas",
      "https://github.com/kirito0000001/CrossingVoid/releases/download/PC-V0.5.14/CrossingVoid__Content__Paks__pakchunk0-Windows.ucas",
    ]);

    const githubFirst = buildGamePackageUrlCandidates({ ...options, preferred: "github" });
    expect(githubFirst[0]).toContain("releases/download/PC-V0.5.14/");
    expect(githubFirst[1]).toContain("dl.crossingvoid.top");

    // 渠道被关掉的源不参与候选（这就是"双源混用"受渠道开关约束的地方）。
    expect(
      buildGamePackageUrlCandidates({ ...options, preferred: "official", githubEnabled: false }),
    ).toHaveLength(1);
    expect(
      buildGamePackageUrlCandidates({ ...options, preferred: "github", githubEnabled: false }),
    ).toEqual([officialGamePackageFileUrl(options.officialBaseUrl, options.path)]);
  });

  it("keeps the core file identical across repos (hash check)", () => {
    // 这份文件在 PC 与 Android 两个仓库里逐字相同；改动后要把新哈希同步到两边测试里。
    const source = readFileSync(resolve(process.cwd(), "src/gamePackage.ts"), "utf8")
      .split("\r\n")
      .join("\n");
    expect(GAME_PACKAGE_CORE_VERSION).toBe("1");
    expect(createHash("sha256").update(source, "utf8").digest("hex")).toBe(
      "141469941f0cebd65a954ca4e806d513aa5fef0d1bb0612b6a4a8bb614894783",
    );
  });
});
