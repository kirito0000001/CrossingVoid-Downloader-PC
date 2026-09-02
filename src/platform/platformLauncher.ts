import { computed, ref } from "vue";

import {
  DEFAULT_PLATFORM_GAME_ID,
  getPlatformGame,
  isPlatformGameId,
  PLATFORM_GAMES,
  type PlatformGameId,
} from "./gameCatalog";

export const ACTIVE_GAME_STORAGE_KEY = "tfac-launcher.active-game";
export const DETAILS_COLLAPSED_STORAGE_KEY = "tfac-launcher.details-collapsed";
export const GAME_OVERVIEW_STORAGE_KEY = "tfac-launcher.game-overview";

type PlatformStorage = Pick<Storage, "getItem" | "setItem">;

export function createPlatformLauncher(storage?: PlatformStorage | null) {
  const savedGame = storage?.getItem(ACTIVE_GAME_STORAGE_KEY);
  const activeGameId = ref<PlatformGameId>(
    isPlatformGameId(savedGame) ? savedGame : DEFAULT_PLATFORM_GAME_ID,
  );
  const detailsCollapsed = ref(
    storage?.getItem(DETAILS_COLLAPSED_STORAGE_KEY) === "1",
  );
  const gameOverviewVisible = ref(
    storage?.getItem(GAME_OVERVIEW_STORAGE_KEY) === "1",
  );
  const activeGame = computed(() => getPlatformGame(activeGameId.value));

  function selectGame(id: PlatformGameId) {
    activeGameId.value = id;
    gameOverviewVisible.value = false;
    storage?.setItem(ACTIVE_GAME_STORAGE_KEY, id);
    storage?.setItem(GAME_OVERVIEW_STORAGE_KEY, "0");
  }

  function setGameOverviewVisible(visible: boolean) {
    gameOverviewVisible.value = visible;
    storage?.setItem(GAME_OVERVIEW_STORAGE_KEY, visible ? "1" : "0");
  }

  function setDetailsCollapsed(collapsed: boolean) {
    detailsCollapsed.value = collapsed;
    storage?.setItem(DETAILS_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  }

  function toggleDetails() {
    setDetailsCollapsed(!detailsCollapsed.value);
  }

  return {
    activeGame,
    activeGameId,
    detailsCollapsed,
    gameOverviewVisible,
    games: PLATFORM_GAMES,
    selectGame,
    setGameOverviewVisible,
    setDetailsCollapsed,
    toggleDetails,
  };
}
