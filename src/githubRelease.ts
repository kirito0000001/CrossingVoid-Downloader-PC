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

import { pickGitHubGameRelease, type GitHubReleaseSummary } from "./gamePackage";

export type { GitHubReleaseAssetSummary, GitHubReleaseSummary } from "./gamePackage";

export function selectGitHubPlatformRelease(
  releases: GitHubReleaseSummary[],
  options: { tagPrefix: string; manifestAssetName: string; allowPrerelease?: boolean },
) {
  // 挑选规则在共用内核里（安卓那边用同一份），这里只是保持原有返回结构：
  // 调用方要的是 release 对象和带 id 的附件（用来走 GitHub 附件 API）。
  const picked = pickGitHubGameRelease(releases, {
    tagPrefix: options.tagPrefix,
    assetName: options.manifestAssetName,
    allowPrerelease: options.allowPrerelease,
  });
  if (!picked) return null;

  const release = releases.find((item) => (item.tag_name ?? "").trim() === picked.tag);
  if (!release) return null;
  const manifestAsset = release.assets?.find((asset) => asset === picked.asset);
  if (!manifestAsset?.id) return null;
  return { release, manifestAsset };
}

export { pickGitHubGameRelease };
