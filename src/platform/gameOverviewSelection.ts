import type { PlatformGameId } from "./gameCatalog";

export type GameOverviewSelection = {
  previewGameId: PlatformGameId;
  armedGameId: PlatformGameId | null;
};

export type GameOverviewActivation =
  | { action: "select"; state: GameOverviewSelection }
  | { action: "enter"; gameId: PlatformGameId; state: GameOverviewSelection };

export function openGameOverview(selectedGameId: PlatformGameId): GameOverviewSelection {
  return { previewGameId: selectedGameId, armedGameId: null };
}

export function activateGameOverviewItem(
  state: GameOverviewSelection,
  gameId: PlatformGameId,
): GameOverviewActivation {
  if (state.previewGameId !== gameId || state.armedGameId !== gameId) {
    return {
      action: "select",
      state: { previewGameId: gameId, armedGameId: gameId },
    };
  }

  return { action: "enter", gameId, state };
}
