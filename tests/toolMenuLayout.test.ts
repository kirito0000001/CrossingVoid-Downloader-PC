import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("compact tool menu layout", () => {
  it("keeps menu actions compact at scaled desktop resolutions", () => {
    const menuRule = appSource.match(/\.tool-menu \{[\s\S]*?\n\}/)?.[0];
    const buttonRule = appSource.match(/\.tool-menu button \{[\s\S]*?\n\}/)?.[0];
    const toggleRule = appSource.match(/\.tool-menu \.tool-menu-toggle \{[\s\S]*?\n\}/)?.[0];

    expect(menuRule).toContain("padding: 6px");
    expect(buttonRule).toContain("height: 36px");
    expect(toggleRule).toContain("margin-top: 2px");
  });
});
