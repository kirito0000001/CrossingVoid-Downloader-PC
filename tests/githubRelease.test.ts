import { describe, expect, it } from "vitest";
import {
  buildGitHubReleaseAssetApiUrl,
  githubGameChunkAssetName,
  selectGitHubPlatformRelease,
} from "../src/githubRelease";

describe("buildGitHubReleaseAssetApiUrl", () => {
  it("uses the release asset API instead of the blocked github.com download page", () => {
    expect(buildGitHubReleaseAssetApiUrl("kirito0000001/CrossingVoid", 459550183)).toBe(
      "https://api.github.com/repos/kirito0000001/CrossingVoid/releases/assets/459550183",
    );
  });

  it("rejects invalid repositories and asset ids", () => {
    expect(buildGitHubReleaseAssetApiUrl("", 459550183)).toBe("");
    expect(buildGitHubReleaseAssetApiUrl("kirito0000001/CrossingVoid", 0)).toBe("");
  });
});

describe("githubGameChunkAssetName", () => {
  it("maps the Chinese PC chunk name to GitHub's numeric asset alias", () => {
    expect(githubGameChunkAssetName({ index: 1, fileName: "CrossingVoid电脑端.碎片001" })).toBe("CrossingVoid.001");
    expect(githubGameChunkAssetName({ index: 12, fileName: "CrossingVoid电脑端.碎片012" })).toBe("CrossingVoid.012");
  });

  it("preserves older or unrelated release asset names", () => {
    expect(githubGameChunkAssetName({ index: 1, fileName: "CrossingVoid.zip.part001" })).toBe("CrossingVoid.zip.part001");
    expect(githubGameChunkAssetName({ fileName: "custom.bin" })).toBe("custom.bin");
  });
});

describe("selectGitHubPlatformRelease", () => {
  const androidRelease = {
    tag_name: "Android-V0.5.13.1-Beta",
    draft: false,
    assets: [{ id: 2, name: "CrossingVoid-Android-update.json" }],
  };
  const pcRelease = {
    tag_name: "PC-V0.5.14",
    draft: false,
    prerelease: false,
    assets: [{ id: 3, name: "CrossingVoid-PC-update.json" }],
  };

  it("selects the PC release even when a newer Android release is first", () => {
    expect(
      selectGitHubPlatformRelease([androidRelease, pcRelease], {
        tagPrefix: "PC-",
        manifestAssetName: "CrossingVoid-PC-update.json",
      }),
    ).toEqual({ release: pcRelease, manifestAsset: pcRelease.assets[0] });
  });

  it("ignores drafts and releases missing the platform manifest", () => {
    expect(
      selectGitHubPlatformRelease(
        [
          { ...pcRelease, draft: true },
          { ...pcRelease, tag_name: "PC-V0.5.15", assets: [{ id: 4, name: "update.json" }] },
        ],
        { tagPrefix: "PC-", manifestAssetName: "CrossingVoid-PC-update.json" },
      ),
    ).toBeNull();
  });

  it("ignores a newer PC beta release for the stable launcher", () => {
    const betaRelease = { ...pcRelease, tag_name: "PC-V0.5.15-Beta", prerelease: true };
    expect(
      selectGitHubPlatformRelease([betaRelease, pcRelease], {
        tagPrefix: "PC-",
        manifestAssetName: "CrossingVoid-PC-update.json",
      }),
    ).toEqual({ release: pcRelease, manifestAsset: pcRelease.assets[0] });
  });
});
