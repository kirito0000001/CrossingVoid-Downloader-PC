import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  launcherStyleFilePaths,
  launcherVueFilePaths,
  readSource,
} from "./helpers/launcherSources";

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
    for (const vueFile of launcherVueFilePaths) {
      const styleTags = [...readSource(vueFile).matchAll(/<style[^>]*\ssrc=[^>]*>/g)].map(
        (match) => match[0],
      );

      for (const tag of styleTags) {
        expect(tag, `${vueFile}: ${tag}`).toContain("scoped");
      }
    }

    expect(launcherStyleFilePaths.length).toBeGreaterThan(0);
  });
});
