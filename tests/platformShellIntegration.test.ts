import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const railSource = readFileSync(
  resolve(process.cwd(), "src/components/PlatformGameRail.vue"),
  "utf8",
);
const overviewSource = readFileSync(
  resolve(process.cwd(), "src/components/PlatformGameOverview.vue"),
  "utf8",
);

describe("platform shell integration", () => {
  it("uses the active game for boot branding and page rendering", () => {
    expect(appSource).toContain(":src=\"activeGame.bootLogoSrc");
    expect(appSource).toContain(":src=\"activeGame.brandLogoSrc");
    expect(appSource).toContain("isCrossingVoidActive");
    expect(appSource).toContain("platform-placeholder-page");
    expect(appSource).toContain('new URLSearchParams(window.location.search).has("holdBoot")');
  });

  it("shows a reusable game rail when details are collapsed", () => {
    expect(appSource).toContain("<PlatformGameRail");
    expect(appSource).toContain(":games=\"platformGames\"");
    expect(appSource).toContain("@select=\"selectPlatformGame\"");
    expect(appSource).toContain("@overview=\"openPlatformGameOverview\"");
    expect(railSource).toContain("v-for=\"game in games\"");
    expect(railSource).toContain("game.iconSrc");
    expect(railSource).toContain("platform-overview-button");
    expect(railSource).toContain("<style scoped>");
    expect(railSource).toContain("left: 58px");
    expect(railSource).toContain("bottom: 180px");
    expect(railSource).toContain("justify-content: center");
  });

  it("renders a large-cover overview that enters the selected game page", () => {
    expect(overviewSource).toContain("platform-game-overview");
    expect(overviewSource).toContain("position: fixed");
    expect(overviewSource).toContain("height: 100vh");
    expect(appSource).toContain("<PlatformGameOverview");
    expect(overviewSource).toContain("emit('select', game.id)");
    expect(appSource).toContain("activateGameOverviewItem(overviewSelection.value, id)");
    expect(overviewSource).toContain("platform-game-cover__selected");
    expect(overviewSource).toContain("查看详情");
    expect(overviewSource).not.toContain("width: 82px");
    expect(overviewSource).toContain("platform-game-overview__background");
    expect(overviewSource).toContain("top: 80vh");
    expect(overviewSource).toContain("handleWheel");
    expect(overviewSource).toContain("games.length > 6");
    expect(overviewSource).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(overviewSource).toContain("has-background");
    expect(overviewSource).toContain("previewGame.englishName");
    expect(overviewSource).toContain("previewGame.description");
    expect(appSource).not.toContain("launcher-shell.platform-overview-active");
    expect(appSource).toContain("gameOverviewVisible");
  });

  it("does not run Crossing Void network work while another page is active", () => {
    expect(appSource).toContain("if (!isCrossingVoidActive.value || launcherNetworkLocked.value) return;");
    expect(appSource).toContain("if (!isCrossingVoidActive.value) return false;");
    expect(appSource).toContain("if (event.payload && isCrossingVoidActive.value)");
  });
});
