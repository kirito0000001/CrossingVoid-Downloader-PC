import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { quickLinks } from "../src/launcherData";
import { readSource } from "./helpers/launcherSources";

describe("launcher quick links", () => {
  it("offers a bug report entry pointing at the Gitee issues page", () => {
    const bugReport = quickLinks.find((link) => link.key === "bug-report");
    expect(bugReport?.url).toBe("https://gitee.com/xiaojie578/CrossingVoid/issues");
    expect(bugReport?.iconSrc).toBe("/launcher/icons/bug-report.svg");
    expect(existsSync(resolve(process.cwd(), "public/launcher/icons/bug-report.svg"))).toBe(true);
    // 爱发电入口已被替换掉。
    expect(quickLinks.some((link) => link.key === "afdian")).toBe(false);
  });

  it("ships a white glyph for it (the dark button provides the background)", () => {
    const svg = readFileSync(
      resolve(process.cwd(), "public/launcher/icons/bug-report.svg"),
      "utf8",
    );
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain("<path");
  });

  it("keeps the afdian icon on disk for future games even though the entry is gone", () => {
    // 爱发电入口已换成 BUG 提交，但这个图标要留给之后别的游戏用，别当"无用资源"删掉。
    expect(existsSync(resolve(process.cwd(), "public/launcher/icons/afdian.svg"))).toBe(true);
  });

  it("keeps the header above the warning banner so hover tooltips are not covered", () => {
    // 顶部那条"当前渠道已关闭 / 流量不足"是 position: fixed，层级比 header 高就会盖住悬停提示。
    const titlebar = readSource("src/styles/titlebar.css");
    const titlebarZ = Number(/\.titlebar\s*\{[^}]*z-index:\s*(\d+)/.exec(titlebar)?.[1]);
    const bannerZ = Number(/\.traffic-warning\s*\{[^}]*z-index:\s*(\d+)/.exec(titlebar)?.[1]);
    expect(Number.isFinite(titlebarZ)).toBe(true);
    expect(Number.isFinite(bannerZ)).toBe(true);
    expect(titlebarZ).toBeGreaterThan(bannerZ);
  });
});
