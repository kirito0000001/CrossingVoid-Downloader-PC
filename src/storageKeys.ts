export const LANGUAGE_STORAGE_KEY = "crossing-void.launcher.language";

/**
 * 下载/安装状态按**游戏**分开存：一档游戏一份，切档时互不覆盖。
 * 零境这一档的 id 就是 `crossing-void`，所以老键名原样命中，老玩家无感迁移。
 */
export function downloadStateStorageKey(gameId: string) {
  return `${gameId}.launcher.download-state`;
}

export const DOWNLOAD_STATE_STORAGE_KEY = "crossing-void.launcher.download-state";
export const DOWNLOAD_SOURCE_STORAGE_KEY = "crossing-void.launcher.download-source";
export const OFFLINE_MODE_STORAGE_KEY = "crossing-void.launcher.offline-mode";
export const DOWNLOAD_LIMITED_STORAGE_KEY = "crossing-void.launcher.download-limited";
export const SPEED_LIMIT_STORAGE_KEY = "crossing-void.launcher.speed-limit";
export const USE_DX11_STORAGE_KEY = "crossing-void.launcher.use-dx11";
export const CLOSE_TO_TRAY_STORAGE_KEY = "crossing-void.launcher.close-to-tray";
export const AUTO_REPAIR_STORAGE_KEY = "crossing-void.launcher.auto-repair";
export const HIDE_AFTER_GAME_LAUNCH_STORAGE_KEY = "crossing-void.launcher.hide-after-game-launch";
/** 下载时要不要在首选源取不到的情况下自动改用另一个源（关掉就只用玩家选的那个，测速用）。 */
export const AUTO_SOURCE_FALLBACK_STORAGE_KEY = "crossing-void.launcher.auto-source-fallback";
/** GitHub 域名要不要借系统代理下载（关掉走直连；直连更快/代理解析 GitHub 慢的人用得上）。 */
export const GITHUB_USE_SYSTEM_PROXY_STORAGE_KEY = "crossing-void.launcher.github-use-system-proxy";
export const DEV_PACKAGE_PATH_STORAGE_KEY = "crossing-void.launcher.dev-package-path";
export const DEV_GAME_VERSION_STORAGE_KEY = "crossing-void.launcher.dev-game-version";
export const DEV_GAME_TITLE_STORAGE_KEY = "crossing-void.launcher.dev-game-title";
export const DEV_GAME_WINDOWS_PATH_STORAGE_KEY = "crossing-void.launcher.dev-game-windows-path";
export const DEV_GAME_ANDROID_PATH_STORAGE_KEY = "crossing-void.launcher.dev-game-android-path";
/** 开发/测试开关：勾上后启动加载界面一直停着不消失（调它的尺寸用）。 */
export const HOLD_BOOT_SPLASH_STORAGE_KEY = "crossing-void.launcher.hold-boot-splash";
