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

  it("keeps the remote notice styles in a stylesheet App.vue itself imports", () => {
    // 公告那段 DOM 在 App.vue 里。样式一旦只留在别的组件（比如 SettingsPanel）的
    // scoped 文件里，选择器带的是那个组件的 data-v 哈希，公告匹配不到任何规则，
    // 弹窗会退回浏览器默认样式：贴左上角、被左侧游戏栏压住、被窗口边缘切掉。
    const importedByApp = [...readSource("src/App.vue").matchAll(/<style[^>]*\ssrc="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(importedByApp.some((path) => path.includes("remote-notice.css"))).toBe(true);
    expect(readSource("src/styles/remote-notice.css")).toContain(".remote-notice-mask");
    expect(readSource("src/styles/settings-panel.css")).not.toContain(".remote-notice-mask");
  });

  it("keeps the danger confirm dialog styles in the component that renders it", () => {
    // 和上面那条互为镜像：弹窗 DOM 从 App.vue 搬进 SettingsPanel.vue 时，样式没跟着走。
    // 于是 `.confirm-mask` / `.confirm-panel` 一条规则都匹配不到，遮罩退回普通块级元素、
    // 被上面 100% 高的设置弹窗顶出窗口 —— 现场就是「点删除游戏 / 卸载启动器没反应」。
    const importedBySettings = [
      ...readSource("src/components/SettingsPanel.vue").matchAll(/<style[^>]*\ssrc="([^"]+)"/g),
    ].map((match) => match[1]);

    expect(importedBySettings.some((path) => path.includes("confirm-dialog.css"))).toBe(true);
    expect(readSource("src/styles/confirm-dialog.css")).toContain(".confirm-mask");
    expect(readSource("src/components/SettingsPanel.vue")).toContain('class="confirm-mask"');
  });
});
