import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLATFORM_GAME_ID,
  PLATFORM_GAMES,
} from "../src/platform/gameCatalog";
import { createPlatformLauncher } from "../src/platform/platformLauncher";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("platform launcher", () => {
  it("keeps the requested five-game order and stable ids", () => {
    expect(PLATFORM_GAMES.map((game) => game.id)).toEqual([
      "tfac-home",
      "crossing-void",
      "fantasy-kill",
      "naruto-bp",
      "white-love",
    ]);
    expect(DEFAULT_PLATFORM_GAME_ID).toBe("crossing-void");
  });

  it("points every catalog art path at a file that exists", () => {
    // 给某一档配图时最容易犯的错就是把路径写错（少个 s、目录记成 icons/…）：
    // 构建照样过，界面上就是一块空白。这里把 catalog 里的非空资源路径钉到 public/ 上。
    for (const game of PLATFORM_GAMES) {
      const sources = [game.iconSrc, game.bootLogoSrc, game.brandLogoSrc, game.backgroundSrc];

      for (const src of sources) {
        if (!src) continue;
        const file = resolve(process.cwd(), "public", src.replace(/^\//, ""));
        expect(existsSync(file), `${game.id}: ${src}`).toBe(true);
      }
    }
  });

  it("writes theme accents as plain #rrggbb", () => {
    // applyThemeAccent() 对不合法的值会静默退回全局配色（金色），
    // 所以写错格式不会报错、只会"没生效"—— 这里提前拦住。
    for (const game of PLATFORM_GAMES) {
      if (!game.themeAccent) continue;
      expect(game.themeAccent, game.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("restores the last selected page and persists later selections", () => {
    const storage = memoryStorage({ "tfac-launcher.active-game": "white-love" });
    const launcher = createPlatformLauncher(storage);

    expect(launcher.activeGameId.value).toBe("white-love");
    launcher.selectGame("fantasy-kill");
    expect(launcher.activeGame.value.id).toBe("fantasy-kill");
    expect(storage.values.get("tfac-launcher.active-game")).toBe("fantasy-kill");
  });

  it("falls back safely and persists the detail-panel collapse state", () => {
    const storage = memoryStorage({
      "tfac-launcher.active-game": "removed-game",
      "tfac-launcher.details-collapsed": "1",
    });
    const launcher = createPlatformLauncher(storage);

    expect(launcher.activeGameId.value).toBe("crossing-void");
    expect(launcher.detailsCollapsed.value).toBe(true);
    launcher.setDetailsCollapsed(false);
    expect(storage.values.get("tfac-launcher.details-collapsed")).toBe("0");
  });

  it("restores the game overview and closes it when a game is selected", () => {
    const storage = memoryStorage({ "tfac-launcher.game-overview": "1" });
    const launcher = createPlatformLauncher(storage);

    expect(launcher.gameOverviewVisible.value).toBe(true);
    launcher.selectGame("naruto-bp");
    expect(launcher.gameOverviewVisible.value).toBe(false);
    expect(storage.values.get("tfac-launcher.game-overview")).toBe("0");
  });
});
