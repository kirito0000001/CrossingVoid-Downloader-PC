import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");

describe("launcher page transitions", () => {
  it("animates news, settings title, and settings content without waiting for an outgoing page", () => {
    expect(appSource).toContain('<Transition name="news-page-motion">');
    expect(appSource).toContain('<Transition name="settings-title-motion">');
    expect(appSource).toContain('<Transition name="settings-page-motion">');
    expect(appSource).not.toMatch(/<Transition\s+name="(?:news-page|settings-title|settings-page)-motion"\s+mode="out-in"/);
  });

  it("keeps page motion on compositor-friendly properties", () => {
    for (const transitionName of ["news-page-motion", "settings-title-motion", "settings-page-motion"]) {
      const activeRule = appSource.match(
        new RegExp(`\\.${transitionName}-enter-active,[\\s\\S]*?\\{([\\s\\S]*?)\\}`),
      )?.[1];

      expect(activeRule, `${transitionName} active rule`).toBeTruthy();
      expect(activeRule).toContain("opacity");
      expect(activeRule).toContain("transform");
      expect(activeRule).not.toMatch(/\b(?:height|width|max-height|max-width|filter|backdrop-filter)\b/);
    }
  });

  it("disables page motion when the operating system requests reduced motion", () => {
    expect(appSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appSource).toMatch(/\.news-page-motion-enter-active,[\s\S]*?transition-duration:\s*0\.01ms/);
  });
});
