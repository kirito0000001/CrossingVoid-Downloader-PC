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
