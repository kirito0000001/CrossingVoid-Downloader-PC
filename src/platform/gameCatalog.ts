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
    implemented: false,
    gamePackage: null,
  },
  {
    id: "crossing-void",
    name: "零境交错：空界幻境",
    englishName: "CROSSING VOID",
    description: "在空界幻境中，连接角色与故事。",
    shortLabel: "零",
    iconSrc: "/launcher/logo_white.png",
    bootLogoSrc: "/launcher/logo_white.png",
    brandLogoSrc: "/launcher/logo_white.png",
    backgroundSrc: "/launcher/hero-bg.jpeg",
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
    implemented: false,
    gamePackage: null,
  },
  {
    id: "naruto-bp",
    name: "火影忍者手游 BP 模拟器",
    englishName: "NARUTO BP SIMULATOR",
    description: "火影忍者手游 BP 模拟器。",
    shortLabel: "忍",
    iconSrc: null,
    bootLogoSrc: null,
    brandLogoSrc: null,
    backgroundSrc: null,
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
