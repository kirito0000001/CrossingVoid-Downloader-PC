import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const shellCss = readFileSync(resolve(process.cwd(), "src/styles/shell-backdrop.css"), "utf8");
const overviewSource = readFileSync(
  resolve(process.cwd(), "src/components/PlatformGameOverview.vue"),
  "utf8",
);
const noticeCss = readFileSync(resolve(process.cwd(), "src/styles/remote-notice.css"), "utf8");

function ruleOf(css: string, selector: string) {
  return new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? "";
}

/** src 下所有源文件（用来确认"整体规则"没有被某个页面偷偷加回来）。 */
function sourceFiles(dir = resolve(process.cwd(), "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|vue|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * 界面尺寸是**整体规则**：整套界面（平台页、设置、公告、开发页、各弹窗、开机动画）都按
 * 1200×675 的设计坐标原样排版，**没有任何跟随窗口的等比缩放**。
 *
 * 2026-09-21 用户用像素对比指出过：一旦整套等比缩放，150% 缩放下窗口只有 1011×569 逻辑像素，
 * 界面被缩到 0.843 倍，按钮就"变小 + 位置偏了"。所以这条规则要靠测试守住，而且必须覆盖全部界面 ——
 * 不允许某个页面自己再引入一份缩放。
 */
describe("启动器界面尺寸规则（整体）", () => {
  it("画布只负责坐标系，不做任何等比缩放", () => {
    const canvasRule = ruleOf(shellCss, ".ui-canvas");
    expect(canvasRule).toContain("position: absolute");
    expect(canvasRule).toContain("inset: 0");
    expect(canvasRule).not.toContain("transform");
    expect(canvasRule).not.toContain("scale(");
    expect(canvasRule).not.toContain("--ui-scale");
  });

  it("窗口比设计尺寸小时裁切，而不是把界面缩小", () => {
    const shellRule = ruleOf(shellCss, ".launcher-shell");
    expect(shellRule).toContain("min-width: 1200px");
    expect(shellRule).toContain("min-height: 675px");
    expect(shellRule).toContain("overflow: hidden");
  });

  it("没有任何页面自己再引入一份窗口缩放", () => {
    // 唯一允许出现缩放开关的地方是这条测试和文档；源码里不许再有 uiScale / --ui-scale。
    // index.html 也要一起查：启动加载界面就在那里，它同样属于"整体规则"。
    const offenders = [...sourceFiles(), resolve(process.cwd(), "index.html")].filter((file) => {
      const text = readFileSync(file, "utf8");
      // 允许注释里提到它（说明为什么不用），只禁止真正的代码/声明。
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "");
      return code.includes("uiScale") || code.includes("--ui-scale");
    });
    expect(offenders).toEqual([]);
  });

  it("画布是所有界面的公共容器：页面、弹窗、开机动画都在里面", () => {
    expect(appSource).toContain('<div class="ui-canvas">');
    const canvasStart = appSource.indexOf('<div class="ui-canvas">');
    const canvasEnd = appSource.lastIndexOf("</div>\n  </main>");
    expect(canvasStart).toBeGreaterThan(0);
    expect(canvasEnd).toBeGreaterThan(canvasStart);
    const inside = appSource.slice(canvasStart, canvasEnd);
    // 逐个确认"每一个界面"都挂在画布内，避免出现"这页缩、那页不缩"。
    // 启动加载界面不在这里：它是 index.html 里的静态层（必须早于打包 CSS，见 bootSplash.ts）。
    for (const marker of [
      'class="titlebar"',
      "<SettingsPanel",
      "remote-notice-mask",
      "<PlatformGameRail",
      "<PlatformGameOverview",
      'class="left-stack"',
      'class="right-launcher"',
    ]) {
      expect(inside).toContain(marker);
    }
  });

  it("画布内不许用 vw/vh 绕开这套坐标系", () => {
    // 只允许外壳自己用 100vw/100vh；画布内一律用 100%。
    expect((shellCss.match(/width:\s*100vw/g) ?? []).length).toBe(1);
    expect((shellCss.match(/height:\s*100vh/g) ?? []).length).toBe(1);
    expect(noticeCss).not.toMatch(/(width|max-height):\s*[^;]*100v[wh]/);
    expect(overviewSource).not.toMatch(/(width|height):\s*100vh/);
    expect(overviewSource).toContain("height: 100%");
  });
});
