import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const menuSource = readFileSync(
  resolve(process.cwd(), "src/components/LauncherToolMenu.vue"),
  "utf8",
);

describe("compact tool menu layout", () => {
  it("keeps menu actions compact at scaled desktop resolutions", () => {
    const menuRule = menuSource.match(/\.tool-menu \{[\s\S]*?\n\}/)?.[0];
    const buttonRule = menuSource.match(/\.tool-menu button \{[\s\S]*?\n\}/)?.[0];
    const toggleRule = menuSource.match(/\.tool-menu \.tool-menu-toggle \{[\s\S]*?\n\}/)?.[0];

    expect(menuRule).toContain("padding: 6px");
    expect(buttonRule).toContain("height: 36px");
    expect(toggleRule).toContain("margin-top: 2px");
  });

  it("owns its own layout and shifted position instead of styling it from App.vue", () => {
    expect(appSource).toContain("<LauncherToolMenu");
    expect(appSource).not.toContain("~ .tool-menu");
    expect(menuSource).toContain(".tool-menu.has-chunk-install {");
    expect(menuSource).toContain("right: 402px");
    expect(menuSource).toContain("<style scoped>");
  });
});
