import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const textSource = readFileSync(
  resolve(process.cwd(), "src/i18n/launcherText.ts"),
  "utf8",
);

describe("launcher text module", () => {
  it("keeps the translation dictionary out of App.vue", () => {
    expect(appSource).toContain('from "./i18n/launcherText"');
    expect(appSource).not.toContain("const translations");
    expect(appSource).not.toContain("const languageLabels");
    expect(appSource).not.toContain("const languageByLabel");
  });

  it("exports the languages, keys and the single lookup helper", () => {
    expect(textSource).toContain("export type LauncherLanguage");
    expect(textSource).toContain("export type TranslationKey");
    expect(textSource).toContain("export const languageLabels");
    expect(textSource).toContain("export const languageOptions");
    expect(textSource).toContain("export const languageByLabel");
    expect(textSource).toContain("export const translations");
    expect(textSource).toContain("export function isLauncherLanguage");
    expect(textSource).toContain("export function translate");
  });

  it("keeps the Chinese fallback inside the shared helper only", () => {
    expect(textSource).toContain('translations[language][key] ?? translations["zh-Hans"][key] ?? key');
    expect(appSource).toContain("const t = (key: TranslationKey) => translate(currentLanguage.value, key)");
  });
});
