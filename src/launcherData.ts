import type {
  CharacterProfile,
  DownloadSourceKey,
  NewsTab,
  NoticeBoard,
  QuickLink,
  VideoItem,
} from "./launcherTypes";
import type { TranslationKey } from "./i18n/launcherText";

export const SETTINGS_SCROLLBAR = {
  viewportBottomInset: 90,
  extraScrollSpace: 90,
  railTop: 154,
  railBottom: 160,
  frameTopOffset: 124,
  frameBottomOffset: 38,
  thumbVisibleRatio: 0.72,
} as const;

export const downloadSources = [
  { key: "official", nameKey: "downloadSource.official", descriptionKey: "downloadSource.officialDesc" },
  { key: "github", nameKey: "downloadSource.github", descriptionKey: "downloadSource.githubDesc" },
] as const satisfies ReadonlyArray<{
  key: DownloadSourceKey;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
}>;

export const chunkImportSources = [
  { name: "QQ群", url: "https://qm.qq.com/q/Nrlo5pBLwY" },
  { name: "百度网盘", url: "https://pan.baidu.com/s/1J5zcggAWiq0Ui47fSZ1P0Q?pwd=2333" },
  { name: "阿里云盘", url: "https://www.alipan.com/s/hGG6ZxsR6Y1" },
  { name: "123云盘", url: "https://www.123684.com/s/SQH4vd-OoPZ3" },
] as const;

export const fallbackCharacterProfiles: CharacterProfile[] = [
  {
    name: "亚丝娜【SAO】",
    work: "刀剑神域",
    tags: ["物理副C", "前排攻击", "追击", "低耗费"],
    banner: "/launcher/character-banners/character-banner-01.png",
  },
  {
    name: "角色 02",
    work: "待填写作品名称",
    tags: ["定位 01", "定位 02", "定位 03", "定位 04"],
    banner: "/launcher/character-banners/character-banner-02.png",
  },
  {
    name: "角色 03",
    work: "待填写作品名称",
    tags: ["定位 01", "定位 02", "定位 03", "定位 04"],
    banner: "/launcher/character-banners/character-banner-03.png",
  },
  {
    name: "角色 04",
    work: "待填写作品名称",
    tags: ["定位 01", "定位 02", "定位 03", "定位 04"],
    banner: "/launcher/character-banners/character-banner-04.png",
  },
  {
    name: "角色 05",
    work: "待填写作品名称",
    tags: ["定位 01", "定位 02", "定位 03", "定位 04"],
    banner: "/launcher/character-banners/character-banner-05.png",
  },
  {
    name: "角色 06",
    work: "待填写作品名称",
    tags: ["定位 01", "定位 02", "定位 03", "定位 04"],
    banner: "/launcher/character-banners/character-banner-06.png",
  },
];

export const fallbackNoticeBoard: NoticeBoard = {
  title: "0.5.12版本更新",
  subtitle: "2026年3月9日",
  banner: "/launcher/character-banners/character-banner-04.png",
  sections: [
    {
      title: "新增内容",
      items: ["移除了登出键", "重做角色：初音未来", "新增场景：演出会场", "新增迷子副本"],
    },
    {
      title: "部分优化",
      items: ["优化了地图生成的代码顺序，防止敌方抢跑行动", "修改了自动模式的底层逻辑，现在敌方会更加灵活"],
    },
    {
      title: "问题修复",
      items: ["修复了SUB优纪[天使]的特效错误", "修复了亚丝娜[SAO]在敌方时，追击不生效的问题"],
    },
  ],
};

export const fallbackVideos: VideoItem[] = [
  { title: "PV公开 | 空界幻境先导影像", date: "06-25", video: "" },
  { title: "实机演示 | 战斗系统与场景预览", date: "06-21", video: "" },
  { title: "开发记录 | 启动器界面制作过程", date: "06-19", video: "" },
];

export const news = {
  notice: [
    { title: "启动器功能测试说明与已知问题", date: "06-25" },
    { title: "客户端资源校验服务维护通知", date: "06-22" },
    { title: "账号数据同步接口占位说明", date: "06-20" },
  ],
  video: [
    { title: "PV公开 | 空界幻境先导影像", date: "06-25" },
    { title: "实机演示 | 战斗系统与场景预览", date: "06-21" },
    { title: "开发记录 | 启动器界面制作过程", date: "06-19" },
  ],
};

export const newsTabs = [
  { key: "characters", labelKey: "news.characters" },
  { key: "notice", labelKey: "news.notice" },
  { key: "video", labelKey: "news.video" },
] as const satisfies ReadonlyArray<{ key: NewsTab; labelKey: TranslationKey }>;

export const quickLinks: QuickLink[] = [
  {
    key: "team-site",
    labelKey: "quick.teamSite",
    tipKey: "quick.teamSiteTip",
    iconSrc: "/launcher/icons/team-site.svg",
    url: "https://64hz.cn/",
  },
  {
    key: "game-site",
    labelKey: "quick.gameSite",
    tipKey: "quick.gameSiteTip",
    iconSrc: "/launcher/icons/game-site.svg",
    url: "https://www.crossingvoid.top/",
  },
  {
    key: "wechat",
    labelKey: "quick.wechat",
    tipKey: "quick.wechatTip",
    iconSrc: "/launcher/icons/wechat.svg",
    qr: "/launcher/wechat-qrcode.jpeg",
    qrAltKey: "quick.wechatQrAlt",
    compact: true,
  },
  {
    key: "bilibili",
    labelKey: "quick.bilibili",
    tipKey: "quick.bilibiliTip",
    iconSrc: "/launcher/icons/bilibili.svg",
    url: "https://space.bilibili.com/452379907",
    qr: "/launcher/bilibili-qrcode-20260626.png",
    qrAltKey: "quick.bilibiliQrAlt",
    compact: true,
  },
  {
    key: "qq",
    labelKey: "quick.qq",
    tipKey: "quick.qqTip",
    iconSrc: "/launcher/icons/qq.svg",
    qr: "/launcher/qq-group-qrcode-20260626.jpg",
    qrAltKey: "quick.qqQrAlt",
    compact: true,
  },
  {
    key: "afdian",
    labelKey: "quick.afdian",
    tipKey: "quick.afdianTip",
    iconSrc: "/launcher/icons/afdian.svg",
    url: "https://ifdian.net/a/Akege304",
  },
];
