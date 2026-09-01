import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("game update metadata source", () => {
  it("reads version metadata from the stable website before a download is requested", () => {
    expect(appSource).toContain(
      'const gameMetadataManifestUrl = "https://www.crossingvoid.top/manifests/game/windows-latest.json";',
    );
    expect(appSource).toContain("fetchGameMetadataArchiveInfo");

    const checkGameVersionSource = appSource.slice(
      appSource.indexOf("async function checkGameVersion"),
      appSource.indexOf("async function openLocalGameFiles"),
    );
    expect(checkGameVersionSource).toContain("fetchGameMetadataArchiveInfo()");
    expect(checkGameVersionSource).not.toContain("resolveBackendArchiveInfo()");
  });

  it("uses the same website manifest for both GitHub and OSS game downloads", () => {
    const resolverSource = appSource.slice(
      appSource.indexOf("async function resolveGameMetadataDownload"),
      appSource.indexOf("async function updateAvailableInstallSpace"),
    );

    expect(resolverSource).toContain("fetchGameMetadataManifest");
    expect(resolverSource).toContain("resolveGameMetadataDownload");
    expect(resolverSource).toContain("manifest.downloadReleaseTag");
    expect(resolverSource).toContain("chunk.githubFileName || chunk.fileName");
    expect(resolverSource).toContain("githubGameChunkAssetName");
    expect(resolverSource).not.toContain("resolveGitHubArchiveInfo");
    expect(resolverSource).not.toContain("resolveBackendArchiveInfo");
  });

  it("accepts only the clean v2 game metadata contract", () => {
    expect(appSource).toContain("schemaVersion: 2;");
    expect(appSource).toContain("downloadReleaseTag: string;");
    expect(appSource).toContain("function validateGameMetadataManifest");
    expect(appSource).not.toContain("releaseTag?: string;");
  });

  it("publishes each platform's GitHub manifest to its Gitee metadata path", () => {
    const bridgeSource = readFileSync(resolve(process.cwd(), "Scripts/Publish-GamePackage.ps1"), "utf8");
    const publisherSource = readFileSync(resolve(process.cwd(), "Scripts/Publish-GameMetadataGitee.ps1"), "utf8");

    expect(bridgeSource).toContain("Publish-GameMetadataGitee.ps1");
    expect(publisherSource).toContain("CrossingVoid-PC-update.json");
    expect(publisherSource).toContain("crossingvoid-android-update.json");
    expect(publisherSource).toContain("game/windows-latest.json");
    expect(publisherSource).toContain("game/android-latest.json");
    expect(publisherSource).toContain('$manifest.schemaVersion -ne 2');
    expect(publisherSource).toContain('$manifest.downloadReleaseTag -ne $target.ReleaseTag');
  });
});
