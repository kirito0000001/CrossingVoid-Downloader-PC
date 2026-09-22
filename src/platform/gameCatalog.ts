export const PLATFORM_GAME_IDS = [
  "tfac-home",
  "crossing-void",
  "fantasy-kill",
  "naruto-bp",
  "white-love",
] as const;

export type PlatformGameId = (typeof PLATFORM_GAME_IDS)[number];

export type PlatformGameDefinition = {
  id: PlatformGameId;
  name: string;
  englishName: string;
  description: string;
  shortLabel: string;
  iconSrc: string | null;
  bootLogoSrc: string | null;
  brandLogoSrc: string | null;
  backgroundSrc: string | null;
  /**
   * 这一档的主题色（`#rrggbb`）。
   *
   * null = 跟随全局配色：`OnSet/Color.json`（没配就是 `:root` 里的 `--cv-theme-default-accent`，金色）。
   * 非 null 时优先级最高，由 App.vue 的 `applyThemeAccent()` 写到 `document.documentElement`
   * 上覆盖 `--cv-theme-accent`（必须写 root：`:root` 里那批派生变量是在声明处替换 var() 的，
   * 挂到画布内的元素上传不下去）。
   */
  themeAccent: string | null;
  implemented: boolean;
  /** 下载站（dl.crossingvoid.top）配置；没接入的游戏为 null。 */
  gamePackage: GamePackageConfig | null;
};

export type GamePackageConfig = {
  /** dl 上的产品段，例如 crossingvoid / crossingvoid-android。 */
  productSegment: string;
  /** 清单里的 productKey，必须与 productSegment 一一对应。 */
  productKey: string;
  runtime: "Windows" | "Android";
  /** 版本标记文件，落位后由启动器读取（诊断用）。 */
  versionMarker: string;
};

export const DEFAULT_PLATFORM_GAME_ID: PlatformGameId = "crossing-void";

export const PLATFORM_GAMES: readonly PlatformGameDefinition[] = [
  {
    id: "tfac-home",
    name: "TFAC 主页",
    englishName: "TFAC HOME",
    description: "TFAC 游戏与工具的统一入口。",
    shortLabel: "TF",
    iconSrc: null,
    bootLogoSrc: null,
    brandLogoSrc: null,
    backgroundSrc: null,
    themeAccent: null,
    implemented: false,
    gamePackage: null,
  },
  {
    id: "crossing-void",
    name: "零境交错：空界幻境",
    englishName: "CROSSING VOID",
    description: "在空界幻境中，连接角色与故事。",
    shortLabel: "零",
    // 侧栏那一格放的是**游戏图标**，不是品牌 logo —— 原来和下面两个共用 logo_white.png，
    // 那是 932 KB 的整张 logo，塞进 38px 的格子里既不对味也白背体积。
    iconSrc: "/launcher/icons/crossing-void.png",
    bootLogoSrc: "/launcher/logo_white.png",
    brandLogoSrc: "/launcher/logo_white.png",
    backgroundSrc: "/launcher/hero-bg.jpeg",
    themeAccent: null,
    implemented: true,
    gamePackage: {
      productSegment: "crossingvoid",
      productKey: "crossingvoid-game",
      runtime: "Windows",
      versionMarker: "CrossingVoid.version.json",
    },
  },
  {
    id: "fantasy-kill",
    name: "幻杀",
    englishName: "FANTASY KILL",
    description: "幻想世界的战斗体验。",
    shortLabel: "幻",
    iconSrc: null,
    bootLogoSrc: null,
    brandLogoSrc: null,
    backgroundSrc: null,
    themeAccent: null,
    implemented: false,
    gamePackage: null,
  },
  {
    id: "naruto-bp",
    name: "火影忍者手游 BP 模拟器",
    englishName: "NARUTO BP SIMULATOR",
    description: "火影忍者手游 BP 模拟器。",
    shortLabel: "忍",
    iconSrc: "/launcher/icons/naruto-bp.png",
    // 品牌位显示宽度 148px、开机动画位 286px，所以 logo 按 2x 备到 572px 宽就够（原图 1072px / 744KB 太大）。
    // 背景图本身是 1950×1080（1.806），比 16:9 略宽，cover 只会左右各裁 ~15px。
    bootLogoSrc: "/launcher/naruto-bp-logo.png",
    brandLogoSrc: "/launcher/naruto-bp-logo.png",
    backgroundSrc: "/launcher/naruto-bp-bg.jpg",
    // 取 logo 里 NARUTO 字样的那个红（色相约 4°）。要更"纯红"可以换成 logo 里的 #fc0000。
    themeAccent: "#f83020",
    implemented: false,
    gamePackage: null,
  },
  {
    id: "white-love",
    name: "白恋",
    englishName: "WHITE LOVE",
    description: "白色恋曲，即将与大家见面。",
    shortLabel: "白",
    iconSrc: null,
    bootLogoSrc: null,
    brandLogoSrc: null,
    backgroundSrc: null,
    themeAccent: null,
    implemented: false,
    gamePackage: null,
  },
] as const;

export function isPlatformGameId(value: unknown): value is PlatformGameId {
  return typeof value === "string" && PLATFORM_GAME_IDS.includes(value as PlatformGameId);
}

export function getPlatformGame(id: PlatformGameId) {
  return PLATFORM_GAMES.find((game) => game.id === id) ?? PLATFORM_GAMES[1];
}

export function getGamePackageConfig(id: PlatformGameId): GamePackageConfig | null {
  return getPlatformGame(id).gamePackage;
}
