import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const bootSplash = readFileSync(resolve(process.cwd(), "src/bootSplash.ts"), "utf8");
const shellCss = readFileSync(resolve(process.cwd(), "src/styles/shell-backdrop.css"), "utf8");
const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as { app: { windows: Array<{ backgroundColor?: string }> } };

/**
 * 启动加载界面曾经的问题：它是 App.vue 里的 `v-if`，样式在打包后的 CSS 里 ——
 * JS 先跑完、主界面先画出来，加载层在 CSS 到位前是个没样式的普通块，
 * 于是用户先看到**主界面闪一下**，加载层随后才"贴"上来。
 *
 * 现在的规则：加载界面是 index.html 的第一帧，DOM 与样式都在那里（内联，不依赖打包 CSS），
 * JS 只负责改文案 / 换 logo / 淡出移除。
 */
describe("启动加载界面", () => {
  it("是 index.html 的第一帧：DOM 与样式都在里面，且排在 app 脚本之前", () => {
    const styleEnd = html.indexOf("</style>");
    const splashMarkup = html.indexOf('id="boot-splash"');
    const appScript = html.indexOf('src="/src/main.ts"');
    expect(styleEnd).toBeGreaterThan(0);
    expect(splashMarkup).toBeGreaterThan(styleEnd);
    expect(appScript).toBeGreaterThan(splashMarkup);

    // 定位与层级必须写在这份内联样式里 —— 这是"不再先闪主界面"的关键。
    const inlineStyle = html.slice(0, styleEnd);
    expect(inlineStyle).toContain("#boot-splash {");
    expect(inlineStyle).toContain("position: fixed");
    expect(inlineStyle).toContain("z-index: 500");
    expect(inlineStyle).toContain("boot-splash__line");
    expect(inlineStyle).toContain("boot-splash__logo");

    // `hidden` 属性只是 UA 样式里的 display:none，会被 `.boot-splash__placeholder { display: grid }` 盖掉 ——
    // 少了这条兜底，"有 logo 时隐藏占位方块"就会失效（现场表现：logo 上方多出一个「零」方块）。
    expect(inlineStyle).toContain("#boot-splash [hidden]");
    expect(inlineStyle).toContain("display: none !important");

    // 内容层是"固定 1200×675 的设计框，居中放置、**不做等比缩放**"：
    // 中间的 logo/进度线/文案始终居中，尺寸恒为设计值。
    expect(inlineStyle).toContain(".boot-splash__scaled");
    expect(inlineStyle).toContain("width: 1200px");
    expect(inlineStyle).toContain("height: 675px");
    expect(inlineStyle).toContain("transform: translate(-50%, -50%)");
    // 内容写死设计尺寸，别再出现会被网格区域吃掉的百分比 max-width。
    expect(inlineStyle).toContain("width: 286px");
    expect(inlineStyle).toContain("width: 284px");
    expect(inlineStyle).not.toContain("max-width: 36%");
    // 右下角那行挂在遮罩下、相对窗口定位（不能放进上面那个设计框里，否则会跟着框跑偏）。
    expect(html).toContain("<strong>Now Loading...</strong>");
    expect(inlineStyle).toContain("#boot-splash > strong");
    expect(inlineStyle).toContain("right: 66px");
    expect(inlineStyle).toContain("bottom: 44px");
    // 启动页不许再引入"跟随窗口的缩放"（整体规则的守卫在 launcherUiSizeRule.test.ts）。
    expect(html).not.toContain("--boot-scale");
    expect(html).not.toContain("scale(var(");

    // 加载层是图片 + 文字，默认能被鼠标框选、logo 还能被拖走 —— 必须关掉。
    expect(inlineStyle).toContain("user-select: none");
    expect(inlineStyle).toContain("-webkit-user-drag: none");
    expect(html).toContain('draggable="false"');
  });

  it("加载层只有一份：App.vue 不再渲染它，样式也不在打包 CSS 里", () => {
    expect(appSource).not.toContain("bootSplashVisible");
    expect(appSource).not.toContain("bootSplashStatus");
    expect(appSource).not.toContain('class="boot-splash"');
    expect(shellCss).not.toContain(".boot-splash");
  });

  it("文案 / logo 由 bootSplash.ts 更新，加载完淡出并移除", () => {
    expect(appSource).toContain("updateBootSplash({");
    expect(appSource).toContain("finishBootSplash()");
    // 常驻判断只能在 bootSplash.ts 里；App.vue 的调度器不许按常驻提前 return ——
    // 那样 finishBootSplash() 就不会被调用，Esc 逃生口也就挂不上（真实踩过）。
    expect(bootSplash).toContain("isBootSplashHeld()");
    expect(appSource).not.toContain("isBootSplashHeld");
    expect(bootSplash).toContain("export function updateBootSplash");
    expect(bootSplash).toContain("export function finishBootSplash");
    // 必须真的移除：它盖在所有界面之上，留着就是挡住点击的空图层。
    expect(bootSplash).toContain("splash.remove()");
    // 常驻是开发/测试功能：由 localStorage 开关（开发页的勾选框）或 ?holdBoot 决定。
    expect(bootSplash).toContain("HOLD_BOOT_SPLASH_STORAGE_KEY");
    expect(bootSplash).toContain('has("holdBoot")');
  });

  it("窗口背景色兜住 JS 起来之前的空白帧", () => {
    expect(tauriConfig.app.windows[0].backgroundColor).toBe("#0a0e11");
  });

  it("加载界面常驻是开发页里的一个开关（下次启动生效，取消勾选立刻收掉）", () => {
    const settingsPanel = readFileSync(
      resolve(process.cwd(), "src/components/SettingsPanel.vue"),
      "utf8",
    );
    const devConsole = readFileSync(
      resolve(process.cwd(), "src/dev/useDeveloperConsole.ts"),
      "utf8",
    );
    expect(settingsPanel).toContain("developerHoldBootSplash");
    expect(settingsPanel).toContain("加载界面常驻");
    expect(devConsole).toContain("HOLD_BOOT_SPLASH_STORAGE_KEY");
    expect(devConsole).toContain("releaseHeldBootSplash()");
    expect(bootSplash).toContain("export function releaseHeldBootSplash");
    // 常驻只在下次启动生效，逃生口只给 Esc（鼠标点击要留给调试：点在加载层上不该有反应）。
    expect(bootSplash).toContain('addEventListener("keydown", releaseHeldBootSplash');
    expect(bootSplash).not.toContain("pointerdown");
  });
});
