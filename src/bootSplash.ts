/**
 * 启动加载界面（boot splash）的唯一操作入口。
 *
 * 界面本体写在 `index.html` 里、样式全部内联（原因见那里的注释）：它是窗口的第一帧，
 * 不能等打包后的 CSS。这个模块只负责后面三件事 —— 改文案、按当前游戏换 logo、加载完淡出。
 *
 * 之所以不再放在 App.vue 里：以前它是 `<section v-if="bootSplashVisible" class="boot-splash">`，
 * 样式在打包后的 CSS 里；JS 先跑完、主界面先画出来，加载层在 CSS 到位前是个没样式的普通块，
 * 于是用户先看到主界面闪一下，加载层随后才"贴"上来。
 */

import { HOLD_BOOT_SPLASH_STORAGE_KEY } from "./storageKeys";

const SPLASH_ID = "boot-splash";
const LOGO_ID = "boot-splash-logo";
const PLACEHOLDER_ID = "boot-splash-placeholder";
const STATUS_ID = "boot-splash-status";
/** 与 index.html 里 #boot-splash 的 transition 时长保持一致，用于兜底移除。 */
const FADE_OUT_MS = 340;

/**
 * 加载界面常驻：**开发/测试功能**，正式发布默认是关的。
 *
 * 打开方式（都写进 localStorage，勾一次就记住）：
 * 1. 设置 → 开发 → 「加载界面常驻」，勾上后**下次启动**开始生效；
 * 2. 开发环境也可以直接用 `?holdBoot`（URL 参数，方便自动化/快速验证）。
 *
 * 常驻时 `finishBootSplash()` 不会移除加载层，方便对着它调 logo/进度线/文案的位置和尺寸。
 */
export function isBootSplashHeld() {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(HOLD_BOOT_SPLASH_STORAGE_KEY) === "1") return true;
  return (
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("holdBoot")
  );
}

export type BootSplashUpdate = {
  status?: string;
  /** 当前游戏的白色 logo；传 null 表示该游戏没有 logo，改用短名字方块。 */
  logoSrc?: string | null;
  shortLabel?: string;
};

function byId(id: string) {
  return typeof document === "undefined" ? null : document.getElementById(id);
}

/** 加载界面还在不在（测试与调试用）。 */
export function isBootSplashVisible() {
  return byId(SPLASH_ID) !== null;
}

/** 更新加载界面上的文案 / logo；只改传进来的字段。 */
export function updateBootSplash(update: BootSplashUpdate) {
  if (update.status !== undefined) {
    const status = byId(STATUS_ID);
    if (status && status.textContent !== update.status) {
      status.textContent = update.status;
    }
  }

  if (update.shortLabel !== undefined) {
    const placeholder = byId(PLACEHOLDER_ID);
    if (placeholder) placeholder.textContent = update.shortLabel;
  }

  if (update.logoSrc !== undefined) {
    const logo = byId(LOGO_ID) as HTMLImageElement | null;
    const placeholder = byId(PLACEHOLDER_ID);
    const hasLogo = Boolean(update.logoSrc);
    if (logo) {
      if (hasLogo && logo.getAttribute("src") !== update.logoSrc) {
        logo.setAttribute("src", update.logoSrc as string);
      }
      logo.hidden = !hasLogo;
    }
    if (placeholder) placeholder.hidden = hasLogo;
  }
}

/**
 * 加载完成：淡出并**移除**加载层。
 *
 * 一定要移除而不是只隐藏：它盖在所有界面上面（z-index 500），留着就是一个挡住点击的空图层。
 */
export function finishBootSplash() {
  const splash = byId(SPLASH_ID);
  if (!splash) return;

  if (isBootSplashHeld()) {
    /*
     * 常驻只在"下次启动"生效，勾选/取消都要重启 —— 万一带着它打包发出去，
     * 加载层会一直盖住界面，连设置都进不去、这个开关也就永远改不回来了。
     *
     * 逃生口只留 **Esc**：鼠标点击要留给调试（点在加载层上不该有任何反应），
     * 所以这里不接管鼠标按下事件。
     */
    window.addEventListener("keydown", releaseHeldBootSplash, { once: true });
    return;
  }

  fadeOutAndRemove(splash);
}

/**
 * 把常驻的加载界面立刻收掉（开发页取消勾选时用，不用重启）。
 * 没在常驻时它是空操作。
 */
export function releaseHeldBootSplash() {
  const splash = byId(SPLASH_ID);
  if (!splash) return;
  fadeOutAndRemove(splash);
}

/** 淡出后移除。一定要移除：加载层盖在所有界面之上，留着就是挡住点击的空图层。 */
function fadeOutAndRemove(splash: HTMLElement) {
  splash.classList.add("is-hiding");

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    splash.remove();
  };
  splash.addEventListener("transitionend", remove, { once: true });
  // 兜底：transitionend 在动画被禁用、元素已不可见等情况下不会触发。
  window.setTimeout(remove, FADE_OUT_MS + 120);
}
