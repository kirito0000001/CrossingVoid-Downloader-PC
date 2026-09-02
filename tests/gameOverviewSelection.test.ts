import { describe, expect, it } from "vitest";

import {
  activateGameOverviewItem,
  openGameOverview,
} from "../src/platform/gameOverviewSelection";

describe("platform game overview selection", () => {
  it("only selects the initially highlighted game on the first click", () => {
    const opened = openGameOverview("crossing-void");
    const firstClick = activateGameOverviewItem(opened, "crossing-void");

    expect(firstClick.action).toBe("select");
    expect(firstClick.state.armedGameId).toBe("crossing-void");
  });

  it("enters only after clicking the same selected game again", () => {
    const firstClick = activateGameOverviewItem(openGameOverview("crossing-void"), "fantasy-kill");
    const secondClick = activateGameOverviewItem(firstClick.state, "fantasy-kill");

    expect(firstClick.action).toBe("select");
    expect(secondClick).toMatchObject({ action: "enter", gameId: "fantasy-kill" });
  });

  it("requires another first click after changing the selected game", () => {
    const fantasySelected = activateGameOverviewItem(openGameOverview("crossing-void"), "fantasy-kill");
    const whiteLoveSelected = activateGameOverviewItem(fantasySelected.state, "white-love");

    expect(whiteLoveSelected.action).toBe("select");
    expect(whiteLoveSelected.state).toEqual({
      previewGameId: "white-love",
      armedGameId: "white-love",
    });
  });
});
