import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n/launcherText";

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
    // App.vue 只做转发，占位符替换（`{count}` 之类）留在共享 helper 里。
    expect(appSource).toContain("const t = (key: TranslationKey, replacements?: Record<string, string | number>) =>");
    expect(appSource).toContain("translate(currentLanguage.value, key, replacements)");
    expect(appSource).not.toContain(".replace(/\\{(\\w+)\\}/g");
  });
});

describe("launcher text placeholders", () => {
  it("replaces {count} with the given value", () => {
    expect(translate("zh-Hans", "status.verificationIssues", { count: 3 })).toBe("发现异常 3 项");
    expect(translate("zh-Hans", "feedback.count.bug", { count: 0 })).toBe("当前BUG数目：0。");
  });

  it("keeps unknown placeholders untouched and works without replacements", () => {
    // 没有传 replacements 时，占位符原样保留（调用方漏传时能从文案看出来）。
    expect(translate("zh-Hans", "status.verificationIssues")).toBe("发现异常 {count} 项");
    expect(translate("zh-Hans", "feedback.count.bug", { other: 1 })).toBe("当前BUG数目：{count}。");
  });

  it("falls back to simplified Chinese for a missing key in another language", () => {
    expect(translate("ja", "quick.bugReportTip")).toBe("問題や要望があればこちらへ");
  });
});
