import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { appSource, launcherStyleFilePaths } from "./helpers/launcherSources";

describe("launcher style files", () => {
  it("points every imported stylesheet at a file that exists", () => {
    expect(launcherStyleFilePaths.length).toBeGreaterThan(0);

    for (const file of launcherStyleFilePaths) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(true);
    }
  });

  it("keeps every imported stylesheet scoped", () => {
    // 拆出去的文件如果漏掉 scoped，规则会静默变成全局样式：
    // 构建照样成功，界面却会互相污染，所以这里锁死。
    const styleTags = [...appSource.matchAll(/<style[^>]*\ssrc=[^>]*>/g)].map(
      (match) => match[0],
    );

    expect(styleTags.length).toBe(launcherStyleFilePaths.length);

    for (const tag of styleTags) {
      expect(tag).toContain("scoped");
    }
  });
});
