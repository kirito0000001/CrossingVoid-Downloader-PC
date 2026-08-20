export function buildGitHubReleaseAssetApiUrl(repository: string, assetId: number) {
  const normalizedRepository = repository.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalizedRepository)) return "";
  if (!Number.isSafeInteger(assetId) || assetId <= 0) return "";
  return `https://api.github.com/repos/${normalizedRepository}/releases/assets/${assetId}`;
}

export function githubGameChunkAssetName(chunk: { index?: number; fileName: string }) {
  const match = /^CrossingVoid电脑端\.碎片(\d{3})$/.exec(chunk.fileName);
  if (!match) return chunk.fileName;
  const suffixIndex = Number.parseInt(match[1], 10);
  const index = chunk.index ?? suffixIndex;
  if (!Number.isSafeInteger(index) || index <= 0 || index > 999 || index !== suffixIndex) return chunk.fileName;
  return `CrossingVoid.${String(index).padStart(3, "0")}`;
}

export type GitHubReleaseAssetSummary = {
  id?: number;
  name?: string;
};

export type GitHubReleaseSummary = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAssetSummary[];
};

export function selectGitHubPlatformRelease(
  releases: GitHubReleaseSummary[],
  options: { tagPrefix: string; manifestAssetName: string; allowPrerelease?: boolean },
) {
  const prefix = options.tagPrefix.trim().toLowerCase();
  const manifestName = options.manifestAssetName.trim().toLowerCase();
  if (!prefix || !manifestName) return null;

  for (const release of releases) {
    if (release.draft || (!options.allowPrerelease && release.prerelease)) continue;
    if (!release.tag_name?.toLowerCase().startsWith(prefix)) continue;
    const manifestAsset = release.assets?.find((asset) => asset.name?.toLowerCase() === manifestName);
    if (manifestAsset?.id) return { release, manifestAsset };
  }
  return null;
}
