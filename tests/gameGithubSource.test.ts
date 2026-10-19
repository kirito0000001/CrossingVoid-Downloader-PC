import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PLATFORM_GAMES, gamePackageSources } from "../src/platform/gameCatalog";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

const fantasy = PLATFORM_GAMES.find((game) => game.id === "fantasy-kill");

describe("幻杀 GitHub 源", () => {
  it("把幻杀指向它自己的 GitHub 发布仓", () => {
    expect(fantasy?.implemented).toBe(true);
    expect(fantasy?.runtime?.github).toEqual({
      repository: "kirito0000001/fantasy-project-packages",
      tagPrefix: "PC-V",
    });
    expect(fantasy?.gamePackage?.versionMarker).toBe("FantasyProject.version.json");
  });

  it("只发 GitHub 时版本检查不再白跑官网 latest.json", () => {
    // 0.1.0 下载站还没有 fantasyproject/latest.json —— sources 收窄后官方源先不试
    expect(gamePackageSources(fantasy?.gamePackage ?? null)).toEqual(["github"]);
    expect(appSource).toContain("const sources = gamePackageSources(config);");
    expect(appSource).toContain('if (sources.includes("official") && officialEnabled)');
    expect(appSource).toContain('if (sources.includes("github") && githubEnabled && githubGameRepository())');
    // 设置页也只摆这一档真支持的源，并会把残留的官方源收窄
    expect(appSource).toContain("gamePackageSources(currentGamePackageConfig())");
    expect(appSource).toContain("clampDownloadSourceToActiveGame()");
  });

  it("GitHub API 被限流时退到 Atom 订阅源，再退到上次的 tag", () => {
    // 未鉴权 API 是 60 次/小时，同一出口 IP 很容易 403；releases.atom 不需要配额
    expect(appSource).toContain("releases.atom");
    expect(appSource).toContain("async function resolveGithubGameTag()");
    expect(appSource).toContain("readCachedGithubGameTag()");
    expect(appSource).toContain("saveCachedGithubGameTag(tag)");
    expect(appSource).toContain("tfac-launcher.github-game-tag.");
  });
});
