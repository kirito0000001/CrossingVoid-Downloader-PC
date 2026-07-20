<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import LauncherSelect from "./components/LauncherSelect.vue";
import {
  buildGitHubReleaseAssetApiUrl,
  selectGitHubPlatformRelease,
} from "./githubRelease";
import {
  DownloadTimeEstimator,
  formatEtaClock,
  type DownloadEstimate,
} from "./downloadTimeEstimator";
import { canPromoteInstalledGame, shouldPreserveSavedOperation } from "./downloadStatePolicy";
import {
  CircleAlert,
  ChevronLeft,
  Check,
  ArrowLeft,
  Download,
  FileText,
  FolderOpen,
  Gamepad2,
  HardDriveDownload,
  Info,
  BellOff,
  Menu,
  Megaphone,
  Minus,
  PackageOpen,
  Pause,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  Wrench,
  X,
} from "lucide-vue-next";

type LauncherState =
  | "ready"
  | "downloading"
  | "downloaded"
  | "installing"
  | "paused"
  | "checking"
  | "repairPending"
  | "repairing";
type RepairOperationStage = "idle" | "preparing" | "downloading" | "repairing" | "verifying";
type SettingsTab = "preferences" | "download" | "game" | "about" | "developer";
type NewsTab = "characters" | "notice" | "video";
type LauncherLanguage = "zh-Hans" | "zh-Hant" | "en" | "ja";
type DownloadSourceKey = "official" | "github";
type LauncherUpdateStage = "idle" | "checking" | "downloading" | "installing" | "restarting" | "failed";
type CharacterProfile = {
  name: string;
  work: string;
  tags: string[];
  banner: string;
};
type NoticeSection = {
  title: string;
  items: string[];
};
type NoticeBoard = {
  title: string;
  subtitle: string;
  banner: string;
  sections: NoticeSection[];
};
type RemoteNoticeLevel = "info" | "warning" | "error";
type RemoteLauncherNotice = {
  schemaVersion: 1;
  id: string;
  enabled: boolean;
  level: RemoteNoticeLevel;
  title: string;
  content: string;
  publishedAt: number;
};
type VideoItem = {
  title: string;
  date: string;
  video: string;
};
type ThemeColors = {
  accent?: string;
  support?: string;
};
type OnSetManifest = {
  colors?: ThemeColors | null;
  characters?: CharacterProfile[];
  notice?: NoticeBoard | null;
  videos?: VideoItem[];
};
type UpdateManifestPayload = {
  latest?: {
    version?: string;
    assets?: Array<{
      runtime?: string;
      fileName?: string;
      objectKey?: string;
      sha256?: string;
      sizeBytes?: number;
      downloadUrl?: string;
      chunks?: DownloadArchiveChunk[];
    }>;
  };
};
type DownloadArchiveChunk = {
  index?: number;
  count?: number;
  fileName: string;
  url: string;
  sha256?: string;
  sizeBytes?: number;
  objectKey?: string;
};
type BackendArchiveChunk = {
  index?: number;
  count?: number;
  fileName?: string;
  objectKey?: string;
  sha256?: string;
  sizeBytes?: number;
};
type UpdateManifestSource = {
  directUrl?: string;
  releaseAsset?: string;
  legacyReleaseAsset?: string;
  releaseTagPrefix?: string;
  releaseProvider?: "github";
  backend?: boolean;
};
type BackendUpdateCheckResponse = {
  success?: boolean;
  hasUpdate?: boolean;
  message?: string;
  manifest?: {
    version?: string;
    productKey?: string;
    asset?: {
      fileName?: string;
      sha256?: string;
      sizeBytes?: number;
      downloadUrl?: string;
      objectKey?: string;
      runtime?: string;
      chunks?: BackendArchiveChunk[];
    } | null;
  } | null;
};
type TrafficQuotaResponse = {
  success: boolean;
  available: boolean;
  downloadAllowed: boolean;
  isLow: boolean;
  totalBytes: number;
  remainingBytes: number;
  thresholdBytes: number;
  expiresAt?: string | null;
  updatedAt: string;
  packageCount: number;
  message: string;
};
type DownloadArchiveInfo = {
  version: string;
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  objectKey?: string;
  chunks?: DownloadArchiveChunk[];
};
type InstallProgressEvent = {
  stage: string;
  percent: number;
  currentItems?: number;
  totalItems?: number;
};
type DownloadProgressEvent = {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
};
type RepairSummary = {
  checkedFiles: number;
  repairedFiles: number;
};
type ManifestVerifySummary = {
  checkedFiles: number;
  invalidFiles: number;
  missingFiles: number;
};
type LaunchGameResult = {
  alreadyRunning?: boolean;
  processId?: number;
};
type RepairProgressEvent = {
  stage: string;
  checkedFiles: number;
  totalFiles: number;
  repairedFiles: number;
  currentFile?: string;
  processedBytes?: number;
  totalBytes?: number;
  currentFileBytes?: number;
  currentFileTotalBytes?: number;
  percent: number;
};
type LauncherUpdateConfirmStage = "idle" | "available";
type DevScriptProgressEvent = {
  stage: string;
  percent: number;
  message: string;
};
type DevScriptFinishedEvent = {
  script: Exclude<DeveloperTaskKind, "idle">;
  success: boolean;
  code: number;
  message: string;
};
type DeveloperTaskKind = "idle" | "build" | "publish" | "game-windows" | "game-android";
type DeveloperGamePublishContext = {
  platform: "Windows" | "Android";
  channel: "Stable" | "Test";
  gameDirectory: string;
  releaseVersion: string;
  releaseTitle: string;
};
type GitHubReleasePayload = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{
    id?: number;
    name?: string;
    browser_download_url?: string;
  }>;
};
type QuickLink = {
  key: string;
  labelKey: TranslationKey;
  tipKey: TranslationKey;
  iconSrc: string;
  url?: string;
  qr?: string;
  qrAltKey?: TranslationKey;
  compact?: boolean;
};

type TranslationKey =
  | "brand.title"
  | "nav.quickLinks"
  | "news.characters"
  | "news.notice"
  | "news.video"
  | "window.settings"
  | "window.minimize"
  | "window.close"
  | "action.checking"
  | "action.pauseDownload"
  | "action.cancelInstall"
  | "action.cancelVerification"
  | "action.cancelRepair"
  | "action.cancelling"
  | "action.pauseUpload"
  | "action.resumeUpload"
  | "action.launchingGame"
  | "action.gameRunning"
  | "action.launchGame"
  | "action.updateGame"
  | "action.installGame"
  | "action.installing"
  | "action.resumeDownload"
  | "action.downloadGame"
  | "action.repairFiles"
  | "action.updateLauncher"
  | "action.updateLauncherReady"
  | "status.checking"
  | "status.checkingFile"
  | "status.verificationIssues"
  | "status.filesMissing"
  | "status.repairingFiles"
  | "status.repairPreparing"
  | "status.repairDownloading"
  | "status.repairWriting"
  | "status.repairVerifying"
  | "status.versionChecking"
  | "status.launchingGame"
  | "status.gameRunning"
  | "status.updateAvailable"
  | "status.launcherUpdateChecking"
  | "status.launcherUpdateAvailable"
  | "status.launcherUpdateDownloading"
  | "status.launcherUpdateInstalling"
  | "status.launcherUpdateRestarting"
  | "status.downloading"
  | "download.estimateCalculating"
  | "download.estimateStalled"
  | "download.estimatedRemaining"
  | "download.hour"
  | "download.minute"
  | "download.lessThanMinute"
  | "status.downloaded"
  | "status.installing"
  | "installStage.merging"
  | "installStage.verifying"
  | "installStage.extracting"
  | "installStage.finishing"
  | "status.ready"
  | "status.paused"
  | "status.waiting"
  | "settings.preferences"
  | "settings.download"
  | "settings.game"
  | "settings.about"
  | "settings.developer"
  | "settings.launcherLanguage"
  | "settings.launcherLanguageHint"
  | "settings.runtime"
  | "settings.closeWindow"
  | "settings.exitLauncher"
  | "settings.minimizeToTray"
  | "settings.display"
  | "settings.hideAfterGameLaunch"
  | "settings.downloadSource"
  | "settings.downloadSpeed"
  | "settings.unlimited"
  | "settings.limited"
  | "settings.installPath"
  | "settings.openGameFolder"
  | "settings.relocateGame"
  | "settings.gameLog"
  | "settings.openGameLog"
  | "settings.gameManagement"
  | "settings.deleteGame"
  | "settings.uninstallLauncher"
  | "settings.otherLaunchOptions"
  | "settings.autoRepair"
  | "settings.autoRepairHint"
  | "settings.gameVersion"
  | "settings.aboutLauncher"
  | "settings.launcherVersion"
  | "settings.checkVersion"
  | "settings.checkingLauncherUpdate"
  | "settings.launcherUpdateReady"
  | "settings.launcherLog"
  | "settings.openLogFolder"
  | "settings.termsPolicy"
  | "settings.userAgreement"
  | "settings.privacyPolicy"
  | "dev.setVersion"
  | "dev.versionHint"
  | "dev.packageLauncher"
  | "dev.publishLauncher"
  | "dev.openProjectFolder"
  | "dev.packageTitle"
  | "dev.packagePath"
  | "dev.choosePath"
  | "dev.cancel"
  | "dev.startPackage"
  | "dev.running"
  | "downloadSource.official"
  | "downloadSource.officialDesc"
  | "downloadSource.github"
  | "downloadSource.githubDesc"
  | "traffic.title"
  | "traffic.remaining"
  | "traffic.expires"
  | "traffic.supportHint"
  | "traffic.lowHint"
  | "traffic.updating"
  | "traffic.unavailable"
  | "traffic.low"
  | "traffic.sourcePaused"
  | "profile.featureCode"
  | "profile.weeklyActive"
  | "profile.resourceReserve"
  | "profile.level"
  | "profile.note"
  | "tool.more"
  | "tool.openLocalFiles"
  | "tool.verifyIntegrity"
  | "tool.checkUpdates"
  | "tool.offlineMode"
  | "tool.useDx11"
  | "quick.teamSite"
  | "quick.teamSiteTip"
  | "quick.gameSite"
  | "quick.gameSiteTip"
  | "quick.wechat"
  | "quick.wechatTip"
  | "quick.wechatQrAlt"
  | "quick.bilibili"
  | "quick.bilibiliTip"
  | "quick.bilibiliQrAlt"
  | "quick.qq"
  | "quick.qqTip"
  | "quick.qqQrAlt"
  | "quick.afdian"
  | "quick.afdianTip"
  | "side.expand"
  | "side.collapse"
  | "install.title"
  | "install.close"
  | "install.change"
  | "install.requiredSpace"
  | "install.availableSpace"
  | "install.desktopShortcut"
  | "install.continue"
  | "space.querying"
  | "space.checking"
  | "space.unavailable"
  | "confirm.deleteTitle"
  | "confirm.deleteBody"
  | "confirm.delete"
  | "confirm.uninstallLauncherTitle"
  | "confirm.uninstallLauncherBody"
  | "confirm.uninstallLauncher"
  | "confirm.cancel"
  | "dialog.chooseInstallPath"
  | "dialog.chooseGamePath";

const SETTINGS_SCROLLBAR = {
  viewportBottomInset: 90,
  extraScrollSpace: 90,
  railTop: 154,
  railBottom: 160,
  frameTopOffset: 124,
  frameBottomOffset: 38,
  thumbVisibleRatio: 0.72,
} as const;

const LANGUAGE_STORAGE_KEY = "crossing-void.launcher.language";
const DOWNLOAD_STATE_STORAGE_KEY = "crossing-void.launcher.download-state";
const DOWNLOAD_SOURCE_STORAGE_KEY = "crossing-void.launcher.download-source";
const OFFLINE_MODE_STORAGE_KEY = "crossing-void.launcher.offline-mode";
const DOWNLOAD_LIMITED_STORAGE_KEY = "crossing-void.launcher.download-limited";
const SPEED_LIMIT_STORAGE_KEY = "crossing-void.launcher.speed-limit";
const USE_DX11_STORAGE_KEY = "crossing-void.launcher.use-dx11";
const CLOSE_TO_TRAY_STORAGE_KEY = "crossing-void.launcher.close-to-tray";
const AUTO_REPAIR_STORAGE_KEY = "crossing-void.launcher.auto-repair";
const HIDE_AFTER_GAME_LAUNCH_STORAGE_KEY = "crossing-void.launcher.hide-after-game-launch";
const DEV_PACKAGE_PATH_STORAGE_KEY = "crossing-void.launcher.dev-package-path";
const DEV_GAME_VERSION_STORAGE_KEY = "crossing-void.launcher.dev-game-version";
const DEV_GAME_TITLE_STORAGE_KEY = "crossing-void.launcher.dev-game-title";
const DEV_GAME_WINDOWS_PATH_STORAGE_KEY = "crossing-void.launcher.dev-game-windows-path";
const DEV_GAME_ANDROID_PATH_STORAGE_KEY = "crossing-void.launcher.dev-game-android-path";
const languageLabels: Record<LauncherLanguage, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
};
const languageOptions = Object.values(languageLabels);
const languageByLabel = Object.fromEntries(
  Object.entries(languageLabels).map(([key, label]) => [label, key]),
) as Record<string, LauncherLanguage>;
const translations: Record<LauncherLanguage, Record<TranslationKey, string>> = {
  "zh-Hans": {
    "brand.title": "零境交错:空界幻境",
    "nav.quickLinks": "快捷入口",
    "news.characters": "角色",
    "news.notice": "公告",
    "news.video": "视频",
    "window.settings": "设置",
    "window.minimize": "最小化",
    "window.close": "关闭",
    "action.checking": "检查中",
    "action.pauseDownload": "暂停下载",
    "action.cancelInstall": "取消安装",
    "action.cancelVerification": "取消校验",
    "action.cancelRepair": "取消修复",
    "action.cancelling": "正在取消",
    "action.pauseUpload": "暂停上传",
    "action.resumeUpload": "继续上传",
    "action.launchingGame": "启动中",
    "action.gameRunning": "游戏运行中",
    "action.launchGame": "启动游戏",
    "action.updateGame": "下载更新",
    "action.installGame": "安装游戏",
    "action.installing": "安装中",
    "action.resumeDownload": "继续下载",
    "action.downloadGame": "下载游戏",
    "action.repairFiles": "修复文件",
    "action.updateLauncher": "更新启动器中",
    "action.updateLauncherReady": "更新启动器",
    "status.checking": "正在校验资源清单",
    "status.checkingFile": "正在校验 {file}",
    "status.verificationIssues": "发现异常 {count} 项",
    "status.filesMissing": "游戏文件缺失",
    "status.repairingFiles": "正在补齐文件",
    "status.repairPreparing": "正在准备修复信息",
    "status.repairDownloading": "正在下载修复文件",
    "status.repairWriting": "正在写入修复文件",
    "status.repairVerifying": "正在校验修复结果",
    "status.versionChecking": "检测版本中",
    "status.launchingGame": "正在启动游戏",
    "status.gameRunning": "游戏运行中",
    "status.updateAvailable": "发现新版本",
    "status.launcherUpdateChecking": "检查启动器更新中",
    "status.launcherUpdateAvailable": "发现启动器新版本",
    "status.launcherUpdateDownloading": "更新启动器中",
    "status.launcherUpdateInstalling": "安装启动器更新",
    "status.launcherUpdateRestarting": "更新完成，正在重启启动器",
    "status.downloading": "下载中",
    "download.estimateCalculating": "正在计算剩余时间",
    "download.estimateStalled": "下载暂时无进度",
    "download.estimatedRemaining": "预计剩余",
    "download.hour": "小时",
    "download.minute": "分钟",
    "download.lessThanMinute": "不足1分钟",
    "status.downloaded": "下载完成",
    "status.installing": "正在安装",
    "installStage.merging": "合并安装包",
    "installStage.verifying": "校验安装包",
    "installStage.extracting": "解压资源",
    "installStage.finishing": "完成安装",
    "status.ready": "资源完整",
    "status.paused": "已暂停",
    "status.waiting": "等待下载",
    "settings.preferences": "偏好设置",
    "settings.download": "下载",
    "settings.game": "游戏",
    "settings.about": "关于",
    "settings.developer": "开发",
    "settings.launcherLanguage": "启动器语言",
    "settings.launcherLanguageHint": "选择启动器界面使用的显示语言。",
    "settings.runtime": "运行设置",
    "settings.closeWindow": "关闭启动器窗口",
    "settings.exitLauncher": "退出启动器",
    "settings.minimizeToTray": "最小化到系统托盘",
    "settings.display": "显示设置",
    "settings.hideAfterGameLaunch": "退出游戏后不弹出启动器",
    "settings.downloadSource": "下载源",
    "settings.downloadSpeed": "下载速度",
    "settings.unlimited": "不限制",
    "settings.limited": "限制",
    "settings.installPath": "游戏安装目录",
    "settings.openGameFolder": "打开游戏目录",
    "settings.relocateGame": "重新定位游戏",
    "settings.gameLog": "游戏日志",
    "settings.openGameLog": "打开游戏日志",
    "settings.gameManagement": "游戏管理",
    "settings.deleteGame": "删除游戏",
    "settings.uninstallLauncher": "卸载启动器",
    "settings.otherLaunchOptions": "其他启动选项",
    "settings.autoRepair": "自动修复资源",
    "settings.autoRepairHint": "启动前检查缺失文件并尝试补齐",
    "settings.gameVersion": "游戏版本",
    "settings.aboutLauncher": "关于启动器",
    "settings.launcherVersion": "启动器版本",
    "settings.checkVersion": "检查版本",
    "settings.checkingLauncherUpdate": "检查启动器更新中",
    "settings.launcherUpdateReady": "发现启动器新版本",
    "settings.launcherLog": "启动器日志",
    "settings.openLogFolder": "打开日志目录",
    "settings.termsPolicy": "条款与政策",
    "settings.userAgreement": "用户协议",
    "settings.privacyPolicy": "隐私政策",
    "dev.setVersion": "设置版本号",
    "dev.versionHint": "新版本号必须高于当前版本。当前版本：{version}",
    "dev.packageLauncher": "打包启动器",
    "dev.publishLauncher": "发布新版本包",
    "dev.openProjectFolder": "打开项目文件夹",
    "dev.packageTitle": "选择启动器打包路径",
    "dev.packagePath": "打包输出目录",
    "dev.choosePath": "更改",
    "dev.cancel": "取消",
    "dev.startPackage": "开始打包",
    "dev.running": "执行中",
    "downloadSource.official": "零境交错源",
    "downloadSource.officialDesc": "官方服务器下载源，速度最快。",
    "downloadSource.github": "Github源",
    "downloadSource.githubDesc": "需要魔法。",
    "traffic.title": "服务器可用下载流量",
    "traffic.remaining": "剩余流量",
    "traffic.expires": "最近到期",
    "traffic.supportHint": "可以在启动器主界面顶部支持一下作者，谢谢了。",
    "traffic.lowHint": "服务器当前流量不足，请更换下载源。",
    "traffic.updating": "正在获取服务器流量额度…",
    "traffic.unavailable": "暂时无法获取流量额度，不影响下载。",
    "traffic.low": "服务器当前流量不足，请更换下载源。",
    "traffic.sourcePaused": "服务器当前流量不足，零境交错源下载已暂停。",
    "profile.featureCode": "特征码",
    "profile.weeklyActive": "每周活跃",
    "profile.resourceReserve": "资源储备",
    "profile.level": "等级",
    "profile.note": "查询结果可能存在延迟，正式接口接入前展示占位数据",
    "tool.more": "更多",
    "tool.openLocalFiles": "浏览本地文件",
    "tool.verifyIntegrity": "验证游戏完整性",
    "tool.checkUpdates": "重新检测更新",
    "tool.offlineMode": "单机模式游玩",
    "tool.useDx11": "使用DX11启动",
    "quick.teamSite": "团队官网",
    "quick.teamSiteTip": "访问团队官网",
    "quick.gameSite": "游戏官网",
    "quick.gameSiteTip": "访问游戏官网",
    "quick.wechat": "微信",
    "quick.wechatTip": "扫描关注微信公众号",
    "quick.wechatQrAlt": "微信公众号二维码",
    "quick.bilibili": "B站",
    "quick.bilibiliTip": "访问B站首页",
    "quick.bilibiliQrAlt": "B站主页二维码",
    "quick.qq": "QQ",
    "quick.qqTip": "零境交错同好会",
    "quick.qqQrAlt": "零境交错同好会二维码",
    "quick.afdian": "爱发电",
    "quick.afdianTip": "支持作者（之后开放更多定制内容）",
    "side.expand": "展开左侧栏",
    "side.collapse": "收起左侧栏",
    "install.title": "选择安装路径",
    "install.close": "关闭",
    "install.change": "更改",
    "install.requiredSpace": "所需空间",
    "install.availableSpace": "可用空间",
    "install.desktopShortcut": "桌面快捷方式",
    "install.continue": "继续安装",
    "space.querying": "正在查询",
    "space.checking": "检测中",
    "space.unavailable": "无法检测",
    "confirm.deleteTitle": "删除游戏",
    "confirm.deleteBody": "将删除当前游戏目录，并把启动器状态恢复到未下载。此操作不会卸载启动器。",
    "confirm.delete": "删除",
    "confirm.uninstallLauncherTitle": "卸载启动器",
    "confirm.uninstallLauncherBody": "将先删除当前游戏目录，再打开系统卸载程序卸载启动器本体。请确认已经不需要保留本机文件。",
    "confirm.uninstallLauncher": "卸载",
    "confirm.cancel": "取消",
    "dialog.chooseInstallPath": "选择游戏下载位置",
    "dialog.chooseGamePath": "选择已有游戏目录",
  },
  "zh-Hant": {
    "brand.title": "零境交錯:空界幻境",
    "nav.quickLinks": "快捷入口",
    "news.characters": "角色",
    "news.notice": "公告",
    "news.video": "影片",
    "window.settings": "設定",
    "window.minimize": "最小化",
    "window.close": "關閉",
    "action.checking": "檢查中",
    "action.pauseDownload": "暫停下載",
    "action.cancelInstall": "取消安裝",
    "action.cancelVerification": "取消校驗",
    "action.cancelRepair": "取消修復",
    "action.cancelling": "正在取消",
    "action.pauseUpload": "暫停上傳",
    "action.resumeUpload": "繼續上傳",
    "action.launchingGame": "啟動中",
    "action.gameRunning": "遊戲執行中",
    "action.launchGame": "啟動遊戲",
    "action.updateGame": "下載更新",
    "action.installGame": "安裝遊戲",
    "action.installing": "安裝中",
    "action.resumeDownload": "繼續下載",
    "action.downloadGame": "下載遊戲",
    "action.repairFiles": "修復檔案",
    "action.updateLauncher": "更新啟動器中",
    "action.updateLauncherReady": "更新啟動器",
    "status.checking": "正在校驗資源清單",
    "status.checkingFile": "正在校驗 {file}",
    "status.verificationIssues": "發現異常 {count} 項",
    "status.filesMissing": "遊戲檔案缺失",
    "status.repairingFiles": "正在補齊檔案",
    "status.repairPreparing": "正在準備修復資訊",
    "status.repairDownloading": "正在下載修復檔案",
    "status.repairWriting": "正在寫入修復檔案",
    "status.repairVerifying": "正在校驗修復結果",
    "status.versionChecking": "檢測版本中",
    "status.launchingGame": "正在啟動遊戲",
    "status.gameRunning": "遊戲執行中",
    "status.updateAvailable": "發現新版本",
    "status.launcherUpdateChecking": "檢查啟動器更新中",
    "status.launcherUpdateAvailable": "發現啟動器新版本",
    "status.launcherUpdateDownloading": "更新啟動器中",
    "status.launcherUpdateInstalling": "安裝啟動器更新",
    "status.launcherUpdateRestarting": "更新完成，正在重啟啟動器",
    "status.downloading": "下載中",
    "download.estimateCalculating": "正在計算剩餘時間",
    "download.estimateStalled": "下載暫時無進度",
    "download.estimatedRemaining": "預計剩餘",
    "download.hour": "小時",
    "download.minute": "分鐘",
    "download.lessThanMinute": "不足1分鐘",
    "status.downloaded": "下載完成",
    "status.installing": "正在安裝",
    "installStage.merging": "合併安裝包",
    "installStage.verifying": "校驗安裝包",
    "installStage.extracting": "解壓資源",
    "installStage.finishing": "完成安裝",
    "status.ready": "資源完整",
    "status.paused": "已暫停",
    "status.waiting": "等待下載",
    "settings.preferences": "偏好設定",
    "settings.download": "下載",
    "settings.game": "遊戲",
    "settings.about": "關於",
    "settings.developer": "開發",
    "settings.launcherLanguage": "啟動器語言",
    "settings.launcherLanguageHint": "選擇啟動器介面使用的顯示語言。",
    "settings.runtime": "執行設定",
    "settings.closeWindow": "關閉啟動器視窗",
    "settings.exitLauncher": "退出啟動器",
    "settings.minimizeToTray": "最小化到系統匣",
    "settings.display": "顯示設定",
    "settings.hideAfterGameLaunch": "退出遊戲後不彈出啟動器",
    "settings.downloadSource": "下載源",
    "settings.downloadSpeed": "下載速度",
    "settings.unlimited": "不限制",
    "settings.limited": "限制",
    "settings.installPath": "遊戲安裝目錄",
    "settings.openGameFolder": "開啟遊戲目錄",
    "settings.relocateGame": "重新定位遊戲",
    "settings.gameLog": "遊戲日誌",
    "settings.openGameLog": "開啟遊戲日誌",
    "settings.gameManagement": "遊戲管理",
    "settings.deleteGame": "刪除遊戲",
    "settings.uninstallLauncher": "卸載啟動器",
    "settings.otherLaunchOptions": "其他啟動選項",
    "settings.autoRepair": "自動修復資源",
    "settings.autoRepairHint": "啟動前檢查缺失檔案並嘗試補齊",
    "settings.gameVersion": "遊戲版本",
    "settings.aboutLauncher": "關於啟動器",
    "settings.launcherVersion": "啟動器版本",
    "settings.checkVersion": "檢查版本",
    "settings.checkingLauncherUpdate": "檢查啟動器更新中",
    "settings.launcherUpdateReady": "發現啟動器新版本",
    "settings.launcherLog": "啟動器日誌",
    "settings.openLogFolder": "開啟日誌目錄",
    "settings.termsPolicy": "條款與政策",
    "settings.userAgreement": "使用者協議",
    "settings.privacyPolicy": "隱私政策",
    "dev.setVersion": "設定版本號",
    "dev.versionHint": "新版本號必須高於目前版本。目前版本：{version}",
    "dev.packageLauncher": "打包啟動器",
    "dev.publishLauncher": "發布新版本包",
    "dev.openProjectFolder": "開啟專案資料夾",
    "dev.packageTitle": "選擇啟動器打包路徑",
    "dev.packagePath": "打包輸出目錄",
    "dev.choosePath": "更改",
    "dev.cancel": "取消",
    "dev.startPackage": "開始打包",
    "dev.running": "執行中",
    "downloadSource.official": "零境交錯源",
    "downloadSource.officialDesc": "官方伺服器下載源，速度最快。",
    "downloadSource.github": "Github源",
    "downloadSource.githubDesc": "需要魔法。",
    "traffic.title": "伺服器可用下載流量",
    "traffic.remaining": "剩餘流量",
    "traffic.expires": "最近到期",
    "traffic.supportHint": "可以在啟動器主介面頂部支持一下作者，謝謝了。",
    "traffic.lowHint": "伺服器流量不足，可以切換 Github 源進行下載。",
    "traffic.updating": "正在取得伺服器流量額度…",
    "traffic.unavailable": "暫時無法取得流量額度，不影響下載。",
    "traffic.low": "伺服器目前流量不足",
    "traffic.sourcePaused": "伺服器目前流量不足，零境交錯源下載已暫停。",
    "profile.featureCode": "特徵碼",
    "profile.weeklyActive": "每週活躍",
    "profile.resourceReserve": "資源儲備",
    "profile.level": "等級",
    "profile.note": "查詢結果可能存在延遲，正式介面接入前展示佔位資料",
    "tool.more": "更多",
    "tool.openLocalFiles": "瀏覽本機檔案",
    "tool.verifyIntegrity": "驗證遊戲完整性",
    "tool.checkUpdates": "重新檢測更新",
    "tool.offlineMode": "單機模式遊玩",
    "tool.useDx11": "使用DX11啟動",
    "quick.teamSite": "團隊官網",
    "quick.teamSiteTip": "造訪團隊官網",
    "quick.gameSite": "遊戲官網",
    "quick.gameSiteTip": "造訪遊戲官網",
    "quick.wechat": "微信",
    "quick.wechatTip": "掃描關注微信公眾號",
    "quick.wechatQrAlt": "微信公眾號 QR Code",
    "quick.bilibili": "B站",
    "quick.bilibiliTip": "造訪 B 站首頁",
    "quick.bilibiliQrAlt": "B站首頁 QR Code",
    "quick.qq": "QQ",
    "quick.qqTip": "零境交錯同好會",
    "quick.qqQrAlt": "零境交錯同好會 QR Code",
    "quick.afdian": "愛發電",
    "quick.afdianTip": "支持作者（之後開放更多客製內容）",
    "side.expand": "展開左側欄",
    "side.collapse": "收起左側欄",
    "install.title": "選擇安裝路徑",
    "install.close": "關閉",
    "install.change": "更改",
    "install.requiredSpace": "所需空間",
    "install.availableSpace": "可用空間",
    "install.desktopShortcut": "桌面捷徑",
    "install.continue": "繼續安裝",
    "space.querying": "正在查詢",
    "space.checking": "檢測中",
    "space.unavailable": "無法檢測",
    "confirm.deleteTitle": "刪除遊戲",
    "confirm.deleteBody": "將刪除目前遊戲目錄，並把啟動器狀態恢復到未下載。此操作不會卸載啟動器。",
    "confirm.delete": "刪除",
    "confirm.uninstallLauncherTitle": "卸載啟動器",
    "confirm.uninstallLauncherBody": "將先刪除目前遊戲目錄，再開啟系統卸載程式卸載啟動器本體。請確認已不需要保留本機檔案。",
    "confirm.uninstallLauncher": "卸載",
    "confirm.cancel": "取消",
    "dialog.chooseInstallPath": "選擇遊戲下載位置",
    "dialog.chooseGamePath": "選擇既有遊戲目錄",
  },
  en: {
    "brand.title": "Crossing Void: Illusion Dreamland",
    "nav.quickLinks": "Quick links",
    "news.characters": "Characters",
    "news.notice": "Notices",
    "news.video": "Videos",
    "window.settings": "Settings",
    "window.minimize": "Minimize",
    "window.close": "Close",
    "action.checking": "Checking",
    "action.pauseDownload": "Pause",
    "action.cancelInstall": "Cancel install",
    "action.cancelVerification": "Cancel check",
    "action.cancelRepair": "Cancel repair",
    "action.cancelling": "Cancelling",
    "action.pauseUpload": "Pause upload",
    "action.resumeUpload": "Resume upload",
    "action.launchingGame": "Launching",
    "action.gameRunning": "Running",
    "action.launchGame": "Launch",
    "action.updateGame": "Update",
    "action.installGame": "Install",
    "action.installing": "Installing",
    "action.resumeDownload": "Resume",
    "action.downloadGame": "Download",
    "action.repairFiles": "Repair files",
    "action.updateLauncher": "Updating launcher",
    "action.updateLauncherReady": "Update launcher",
    "status.checking": "Checking manifest",
    "status.checkingFile": "Checking {file}",
    "status.verificationIssues": "{count} issue(s) found",
    "status.filesMissing": "Game files missing",
    "status.repairingFiles": "Repairing files",
    "status.repairPreparing": "Preparing repair data",
    "status.repairDownloading": "Downloading repair files",
    "status.repairWriting": "Writing repair files",
    "status.repairVerifying": "Verifying repaired files",
    "status.versionChecking": "Checking version",
    "status.launchingGame": "Launching game",
    "status.gameRunning": "Game running",
    "status.updateAvailable": "Update available",
    "status.launcherUpdateChecking": "Checking launcher update",
    "status.launcherUpdateAvailable": "Launcher update available",
    "status.launcherUpdateDownloading": "Updating launcher",
    "status.launcherUpdateInstalling": "Installing launcher update",
    "status.launcherUpdateRestarting": "Update complete, restarting launcher",
    "status.downloading": "Downloading",
    "download.estimateCalculating": "Calculating time remaining",
    "download.estimateStalled": "Download is not progressing",
    "download.estimatedRemaining": "About",
    "download.hour": " hr ",
    "download.minute": " min",
    "download.lessThanMinute": "less than 1 min",
    "status.downloaded": "Downloaded",
    "status.installing": "Installing",
    "installStage.merging": "Merging package",
    "installStage.verifying": "Verifying package",
    "installStage.extracting": "Extracting files",
    "installStage.finishing": "Finishing install",
    "status.ready": "Ready",
    "status.paused": "Paused",
    "status.waiting": "Waiting",
    "settings.preferences": "Preferences",
    "settings.download": "Download",
    "settings.game": "Game",
    "settings.about": "About",
    "settings.developer": "Developer",
    "settings.launcherLanguage": "Launcher Language",
    "settings.launcherLanguageHint": "Choose the display language used by the launcher.",
    "settings.runtime": "Runtime",
    "settings.closeWindow": "Close Window",
    "settings.exitLauncher": "Exit launcher",
    "settings.minimizeToTray": "Minimize to tray",
    "settings.display": "Display",
    "settings.hideAfterGameLaunch": "Do not show launcher after exiting game",
    "settings.downloadSource": "Download Source",
    "settings.downloadSpeed": "Download Speed",
    "settings.unlimited": "Unlimited",
    "settings.limited": "Limited",
    "settings.installPath": "Game Install Path",
    "settings.openGameFolder": "Open game folder",
    "settings.relocateGame": "Relocate game",
    "settings.gameLog": "Game Logs",
    "settings.openGameLog": "Open game logs",
    "settings.gameManagement": "Game Management",
    "settings.deleteGame": "Delete game",
    "settings.uninstallLauncher": "Uninstall launcher",
    "settings.otherLaunchOptions": "Other Launch Options",
    "settings.autoRepair": "Auto repair resources",
    "settings.autoRepairHint": "Check missing files before launch and try to repair them",
    "settings.gameVersion": "Game version",
    "settings.aboutLauncher": "About Launcher",
    "settings.launcherVersion": "Launcher version",
    "settings.checkVersion": "Check version",
    "settings.checkingLauncherUpdate": "Checking launcher update",
    "settings.launcherUpdateReady": "Launcher update available",
    "settings.launcherLog": "Launcher Logs",
    "settings.openLogFolder": "Open log folder",
    "settings.termsPolicy": "Terms & Policies",
    "settings.userAgreement": "User Agreement",
    "settings.privacyPolicy": "Privacy Policy",
    "dev.setVersion": "Set version",
    "dev.versionHint": "The new version must be higher than the current version. Current version: {version}",
    "dev.packageLauncher": "Package launcher",
    "dev.publishLauncher": "Publish update package",
    "dev.openProjectFolder": "Open project folder",
    "dev.packageTitle": "Choose launcher package path",
    "dev.packagePath": "Package output folder",
    "dev.choosePath": "Change",
    "dev.cancel": "Cancel",
    "dev.startPackage": "Package",
    "dev.running": "Running",
    "downloadSource.official": "Crossing Void Source",
    "downloadSource.officialDesc": "Official server source with the fastest speed.",
    "downloadSource.github": "Github Source",
    "downloadSource.githubDesc": "Requires proxy access.",
    "traffic.title": "Available Server Download Traffic",
    "traffic.remaining": "Remaining",
    "traffic.expires": "Next expiry",
    "traffic.supportHint": "You can support the author from the top of the launcher home page. Thank you.",
    "traffic.lowHint": "Server traffic is low. You can switch to the Github source to download.",
    "traffic.updating": "Checking server traffic quota…",
    "traffic.unavailable": "Traffic quota is temporarily unavailable. Downloads remain enabled.",
    "traffic.low": "Server traffic quota is low",
    "traffic.sourcePaused": "Server traffic quota is low. The official source download was paused.",
    "profile.featureCode": "Code",
    "profile.weeklyActive": "Weekly Active",
    "profile.resourceReserve": "Reserve",
    "profile.level": "Level",
    "profile.note": "Results may be delayed. Placeholder data is shown before the live API is connected.",
    "tool.more": "More",
    "tool.openLocalFiles": "Browse local files",
    "tool.verifyIntegrity": "Verify game integrity",
    "tool.checkUpdates": "Check updates again",
    "tool.offlineMode": "Offline mode",
    "tool.useDx11": "Launch with DX11",
    "quick.teamSite": "Team Site",
    "quick.teamSiteTip": "Visit team website",
    "quick.gameSite": "Game Site",
    "quick.gameSiteTip": "Visit game website",
    "quick.wechat": "WeChat",
    "quick.wechatTip": "Scan to follow WeChat",
    "quick.wechatQrAlt": "WeChat official account QR code",
    "quick.bilibili": "Bilibili",
    "quick.bilibiliTip": "Visit Bilibili homepage",
    "quick.bilibiliQrAlt": "Bilibili homepage QR code",
    "quick.qq": "QQ",
    "quick.qqTip": "Crossing Void Fan Group",
    "quick.qqQrAlt": "Crossing Void Fan Group QR code",
    "quick.afdian": "Afdian",
    "quick.afdianTip": "Support the creator",
    "side.expand": "Expand sidebar",
    "side.collapse": "Collapse sidebar",
    "install.title": "Choose Install Path",
    "install.close": "Close",
    "install.change": "Change",
    "install.requiredSpace": "Required",
    "install.availableSpace": "Available",
    "install.desktopShortcut": "Desktop shortcut",
    "install.continue": "Continue",
    "space.querying": "Querying",
    "space.checking": "Checking",
    "space.unavailable": "Unavailable",
    "confirm.deleteTitle": "Delete Game",
    "confirm.deleteBody": "Delete the current game folder and reset the launcher to the not-downloaded state. The launcher will not be uninstalled.",
    "confirm.delete": "Delete",
    "confirm.uninstallLauncherTitle": "Uninstall Launcher",
    "confirm.uninstallLauncherBody": "Delete the current game folder first, then open the system uninstaller for the launcher. Make sure you do not need to keep local files.",
    "confirm.uninstallLauncher": "Uninstall",
    "confirm.cancel": "Cancel",
    "dialog.chooseInstallPath": "Choose game download location",
    "dialog.chooseGamePath": "Choose existing game folder",
  },
  ja: {
    "brand.title": "クロッシングヴォイド: 空界幻境",
    "nav.quickLinks": "クイックリンク",
    "news.characters": "キャラ",
    "news.notice": "お知らせ",
    "news.video": "動画",
    "window.settings": "設定",
    "window.minimize": "最小化",
    "window.close": "閉じる",
    "action.checking": "確認中",
    "action.pauseDownload": "一時停止",
    "action.cancelInstall": "インストールを中止",
    "action.cancelVerification": "確認を中止",
    "action.cancelRepair": "修復を中止",
    "action.cancelling": "中止しています",
    "action.pauseUpload": "アップロードを一時停止",
    "action.resumeUpload": "アップロードを再開",
    "action.launchingGame": "起動中",
    "action.gameRunning": "ゲーム実行中",
    "action.launchGame": "起動",
    "action.updateGame": "更新を取得",
    "action.installGame": "インストール",
    "action.installing": "インストール中",
    "action.resumeDownload": "再開",
    "action.downloadGame": "ダウンロード",
    "action.repairFiles": "ファイル修復",
    "action.updateLauncher": "ランチャー更新中",
    "action.updateLauncherReady": "ランチャーを更新",
    "status.checking": "リソース一覧を確認中",
    "status.checkingFile": "確認中 {file}",
    "status.verificationIssues": "異常 {count} 件",
    "status.filesMissing": "ゲームファイル不足",
    "status.repairingFiles": "ファイル修復中",
    "status.repairPreparing": "修復情報を準備中",
    "status.repairDownloading": "修復ファイルをダウンロード中",
    "status.repairWriting": "修復ファイルを書き込み中",
    "status.repairVerifying": "修復結果を確認中",
    "status.versionChecking": "バージョン確認中",
    "status.launchingGame": "ゲーム起動中",
    "status.gameRunning": "ゲーム実行中",
    "status.updateAvailable": "新バージョンあり",
    "status.launcherUpdateChecking": "ランチャー更新を確認中",
    "status.launcherUpdateAvailable": "ランチャー新バージョンあり",
    "status.launcherUpdateDownloading": "ランチャー更新中",
    "status.launcherUpdateInstalling": "ランチャー更新をインストール中",
    "status.launcherUpdateRestarting": "更新完了、ランチャーを再起動中",
    "status.downloading": "ダウンロード中",
    "download.estimateCalculating": "残り時間を計算中",
    "download.estimateStalled": "ダウンロードが進行していません",
    "download.estimatedRemaining": "残り約",
    "download.hour": "時間",
    "download.minute": "分",
    "download.lessThanMinute": "1分未満",
    "status.downloaded": "ダウンロード完了",
    "status.installing": "インストール中",
    "installStage.merging": "パッケージ結合中",
    "installStage.verifying": "パッケージ確認中",
    "installStage.extracting": "リソース展開中",
    "installStage.finishing": "インストール完了中",
    "status.ready": "準備完了",
    "status.paused": "一時停止中",
    "status.waiting": "待機中",
    "settings.preferences": "環境設定",
    "settings.download": "ダウンロード",
    "settings.game": "ゲーム",
    "settings.about": "情報",
    "settings.developer": "開発",
    "settings.launcherLanguage": "ランチャー言語",
    "settings.launcherLanguageHint": "ランチャー画面で使用する表示言語を選択します。",
    "settings.runtime": "起動設定",
    "settings.closeWindow": "ランチャーを閉じる",
    "settings.exitLauncher": "ランチャーを終了",
    "settings.minimizeToTray": "システムトレイに最小化",
    "settings.display": "表示設定",
    "settings.hideAfterGameLaunch": "ゲーム終了後にランチャーを表示しない",
    "settings.downloadSource": "ダウンロード元",
    "settings.downloadSpeed": "ダウンロード速度",
    "settings.unlimited": "無制限",
    "settings.limited": "制限",
    "settings.installPath": "ゲームのインストール先",
    "settings.openGameFolder": "ゲームフォルダを開く",
    "settings.relocateGame": "ゲームを再指定",
    "settings.gameLog": "ゲームログ",
    "settings.openGameLog": "ゲームログを開く",
    "settings.gameManagement": "ゲーム管理",
    "settings.deleteGame": "ゲームを削除",
    "settings.uninstallLauncher": "ランチャーをアンインストール",
    "settings.otherLaunchOptions": "その他の起動オプション",
    "settings.autoRepair": "リソースを自動修復",
    "settings.autoRepairHint": "起動前に不足ファイルを確認し、修復を試みます",
    "settings.gameVersion": "ゲームバージョン",
    "settings.aboutLauncher": "ランチャー情報",
    "settings.launcherVersion": "ランチャーバージョン",
    "settings.checkVersion": "バージョン確認",
    "settings.checkingLauncherUpdate": "ランチャー更新を確認中",
    "settings.launcherUpdateReady": "ランチャー新バージョンあり",
    "settings.launcherLog": "ランチャーログ",
    "settings.openLogFolder": "ログフォルダを開く",
    "settings.termsPolicy": "規約とポリシー",
    "settings.userAgreement": "利用規約",
    "settings.privacyPolicy": "プライバシーポリシー",
    "dev.setVersion": "バージョン設定",
    "dev.versionHint": "新しいバージョンは現在のバージョンより高い必要があります。現在のバージョン：{version}",
    "dev.packageLauncher": "ランチャーをパッケージ",
    "dev.publishLauncher": "新バージョンを公開",
    "dev.openProjectFolder": "プロジェクトフォルダを開く",
    "dev.packageTitle": "ランチャー出力先を選択",
    "dev.packagePath": "出力フォルダ",
    "dev.choosePath": "変更",
    "dev.cancel": "キャンセル",
    "dev.startPackage": "開始",
    "dev.running": "実行中",
    "downloadSource.official": "零境交錯ソース",
    "downloadSource.officialDesc": "公式サーバーのダウンロード元です。速度が最も速いです。",
    "downloadSource.github": "Githubソース",
    "downloadSource.githubDesc": "プロキシが必要です。",
    "traffic.title": "サーバーの利用可能なダウンロード通信量",
    "traffic.remaining": "残り通信量",
    "traffic.expires": "直近の有効期限",
    "traffic.supportHint": "ランチャーのホーム画面上部から作者を応援できます。ありがとうございます。",
    "traffic.lowHint": "サーバー通信量が不足しています。Githubソースに切り替えてダウンロードできます。",
    "traffic.updating": "サーバー通信量を確認しています…",
    "traffic.unavailable": "通信量を取得できません。ダウンロードは引き続き利用できます。",
    "traffic.low": "サーバーの通信量が不足しています",
    "traffic.sourcePaused": "サーバーの通信量不足により、公式ソースのダウンロードを一時停止しました。",
    "profile.featureCode": "識別コード",
    "profile.weeklyActive": "週間活躍",
    "profile.resourceReserve": "備蓄",
    "profile.level": "レベル",
    "profile.note": "結果には遅延がある場合があります。正式 API 接続前は仮データを表示します。",
    "tool.more": "その他",
    "tool.openLocalFiles": "ローカルファイルを開く",
    "tool.verifyIntegrity": "ゲーム整合性を確認",
    "tool.checkUpdates": "更新を再確認",
    "tool.offlineMode": "オフラインで遊ぶ",
    "tool.useDx11": "DX11で起動",
    "quick.teamSite": "チーム公式",
    "quick.teamSiteTip": "チーム公式サイトへ",
    "quick.gameSite": "ゲーム公式",
    "quick.gameSiteTip": "ゲーム公式サイトへ",
    "quick.wechat": "WeChat",
    "quick.wechatTip": "WeChat 公式をフォロー",
    "quick.wechatQrAlt": "WeChat 公式 QR コード",
    "quick.bilibili": "Bilibili",
    "quick.bilibiliTip": "Bilibili ホームへ",
    "quick.bilibiliQrAlt": "Bilibili ホーム QR コード",
    "quick.qq": "QQ",
    "quick.qqTip": "零境交錯ファングループ",
    "quick.qqQrAlt": "零境交錯ファングループ QR コード",
    "quick.afdian": "Afdian",
    "quick.afdianTip": "作者を支援",
    "side.expand": "左サイドバーを展開",
    "side.collapse": "左サイドバーを折りたたむ",
    "install.title": "インストール先を選択",
    "install.close": "閉じる",
    "install.change": "変更",
    "install.requiredSpace": "必要容量",
    "install.availableSpace": "空き容量",
    "install.desktopShortcut": "デスクトップショートカット",
    "install.continue": "続行",
    "space.querying": "確認中",
    "space.checking": "確認中",
    "space.unavailable": "確認できません",
    "confirm.deleteTitle": "ゲームを削除",
    "confirm.deleteBody": "現在のゲームフォルダーを削除し、ランチャー状態を未ダウンロードに戻します。ランチャーはアンインストールされません。",
    "confirm.delete": "削除",
    "confirm.uninstallLauncherTitle": "ランチャーをアンインストール",
    "confirm.uninstallLauncherBody": "現在のゲームフォルダーを削除してから、ランチャーのアンインストーラーを開きます。ローカルファイルを保持する必要がないことを確認してください。",
    "confirm.uninstallLauncher": "アンインストール",
    "confirm.cancel": "キャンセル",
    "dialog.chooseInstallPath": "ゲームのダウンロード先を選択",
    "dialog.chooseGamePath": "既存のゲームフォルダを選択",
  },
};

function isLauncherLanguage(value: string | null): value is LauncherLanguage {
  return value === "zh-Hans" || value === "zh-Hant" || value === "en" || value === "ja";
}

type PersistedDownloadState = {
  installPath?: string;
  selectedInstallBasePath?: string;
  downloadSource?: DownloadSourceKey;
  mode?: "install" | "update" | "repair";
  downloadedBytes?: number;
  totalBytes?: number;
  state?: "paused" | "downloaded" | "ready";
  installStage?: "downloaded" | "merged" | "extracting";
};
type DownloadStateMode = "throttled" | "immediate";

type InstallStage = "downloaded" | "merged" | "extracting";

type RestoredLauncherState = "paused" | "downloaded" | "ready" | "repairPending";

function normalizePersistedState(state: PersistedDownloadState): RestoredLauncherState {
  if (state.mode === "repair") return "repairPending";
  if (state.state === "ready") return "ready";
  if (state.state === "downloaded") return "downloaded";
  const downloaded = persistedNumber(state.downloadedBytes);
  const total = persistedNumber(state.totalBytes);
  return total > 0 && downloaded >= total ? "downloaded" : "paused";
}

function isDownloadSourceKey(value: string | null | undefined): value is DownloadSourceKey {
  return value === "official" || value === "github";
}

function normalizeDownloadSourceKey(value: string | null | undefined): DownloadSourceKey {
  if (value === "gitee") return "github";
  return isDownloadSourceKey(value) ? value : "official";
}

function readPersistedDownloadState(): PersistedDownloadState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DOWNLOAD_STATE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedDownloadState) : null;
  } catch {
    return null;
  }
}

function persistedNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

async function restoreDownloadStateFromDisk() {
  if (restoredDiskDownloadState) return false;
  restoredDiskDownloadState = true;
  try {
    const diskState = await invoke<PersistedDownloadState | null>("read_download_state_file", {
      installPath: installPath.value,
    });
    if (!diskState || (diskState.mode !== "update" && diskState.mode !== "repair" && persistedNumber(diskState.downloadedBytes) <= 0 && diskState.state !== "ready")) return false;
    if (shouldPreserveSavedOperation(savedDownloadState, diskState)) return false;
    const diskDownloadedBytes = persistedNumber(diskState.downloadedBytes);
    const diskTotalBytes = persistedNumber(diskState.totalBytes);
    const diskLooksNewer =
      normalizePersistedState(diskState) !== "paused" ||
      diskDownloadedBytes > downloadedBytes.value ||
      diskTotalBytes > (activeDownloadBytes.value || 0);
    if (!diskLooksNewer) return false;
    const isValid = await validatePersistedDownloadState(diskState);
    if (!isValid) {
      await clearDiskDownloadStateForPath(diskState.installPath || installPath.value);
      return false;
    }
    applyPersistedDownloadState(diskState);
    const restoredState = normalizePersistedState(diskState);
    persistDownloadState(restoredState === "repairPending" ? "paused" : restoredState, "immediate");
    return true;
  } catch (error) {
    console.warn("Unable to restore download state file", error);
    return false;
  }
}

const savedDownloadState = readPersistedDownloadState();
const savedDownloadedBytes = persistedNumber(savedDownloadState?.downloadedBytes);
const savedTotalBytes = persistedNumber(savedDownloadState?.totalBytes);
const launcherVersion = ref(__APP_VERSION__);
const bundledOnSetManifest = ref<OnSetManifest | null>(null);
const keepBootSplashVisibleForLayout = false;
const bootSplashVisible = ref(true);
const bootSplashStatus = ref("Now Loading...");
const launcherState = ref<LauncherState>(savedDownloadState ? normalizePersistedState(savedDownloadState) : "paused");
const savedLanguage = typeof window === "undefined" ? null : window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
const currentLanguage = ref<LauncherLanguage>(isLauncherLanguage(savedLanguage) ? savedLanguage : "zh-Hans");
const offlineMode = ref(typeof window !== "undefined" && window.localStorage.getItem(OFFLINE_MODE_STORAGE_KEY) === "1");
document.documentElement.lang = currentLanguage.value;
const activeNewsTab = ref<NewsTab>("characters");
const activeCharacterBanner = ref(0);
const showSettings = ref(false);
const showDeleteGameConfirm = ref(false);
const showInstallConfirm = ref(false);
const showDevPackageConfirm = ref(false);
const confirmAction = ref<"deleteGame" | "uninstallLauncher">("deleteGame");
const activeSettingsTab = ref<SettingsTab>("preferences");
const versionCheckPending = ref(false);
const pendingRepairSummary = ref<ManifestVerifySummary | null>(
  savedDownloadState?.mode === "repair" ? { checkedFiles: 1, invalidFiles: 1, missingFiles: 1 } : null,
);
const updateAvailable = ref(false);
const updateDownloadPending = ref(savedDownloadState?.mode === "update");
const localGameVersion = ref("");
const remoteGameVersion = ref("");
const lastCheckMessage = ref("");
const trafficQuota = ref<TrafficQuotaResponse | null>(null);
const trafficQuotaPending = ref(false);
const gameLaunchPending = ref(false);
const gameRunning = ref(false);
const launcherUpdatePending = ref(false);
const launcherUpdateStage = ref<LauncherUpdateStage>("idle");
const launcherUpdateConfirmStage = ref<LauncherUpdateConfirmStage>("idle");
// Tauri's Update instance owns private state and must not be wrapped in a Vue Proxy.
const pendingLauncherUpdate = shallowRef<Update | null>(null);
const launcherUpdateVersion = ref("");
const launcherUpdateDownloadedBytes = ref(0);
const launcherUpdateTotalBytes = ref(0);
const developerVersionInput = ref(launcherVersion.value);
function normalizeDeveloperPackagePath(path: string) {
  const trimmed = path.trim();
  const driveRootMatch = /^[A-Za-z]:[\\/]?$/.exec(trimmed);
  if (driveRootMatch) return `${trimmed.slice(0, 2)}\\启动器新包`;
  return trimmed;
}

const developerPackagePath = ref(
  normalizeDeveloperPackagePath(
    typeof window !== "undefined"
      ? window.localStorage.getItem(DEV_PACKAGE_PATH_STORAGE_KEY) || "D:\\启动器新包"
      : "D:\\启动器新包",
  ),
);
const developerGameVersion = ref(window.localStorage.getItem(DEV_GAME_VERSION_STORAGE_KEY) || "V0.5.12");
const developerGameTitle = ref(window.localStorage.getItem(DEV_GAME_TITLE_STORAGE_KEY) || "零境交错：空界幻境更新包");
const developerTaskPending = ref(false);
const developerTaskKind = ref<DeveloperTaskKind>("idle");
const developerTaskPercent = ref(0);
const developerTaskMessage = ref("");
const developerGamePublishContext = ref<DeveloperGamePublishContext | null>(null);
const developerTaskPaused = ref(false);
const developerTaskPauseRequested = ref(false);
const remoteLauncherNotice = ref<RemoteLauncherNotice | null>(null);
const showRemoteLauncherNotice = ref(false);
const developerNoticeTitle = ref("");
const developerNoticeContent = ref("");
const developerNoticeLevel = ref<RemoteNoticeLevel>("info");
const developerNoticePending = ref(false);
const developerNoticeLoaded = ref(false);
const lastVersionCheckAt = ref(0);
let lastCheckMessageTimer: number | undefined;
let gameRunningPollTimer: number | undefined;
let trafficQuotaRefreshTimer: number | undefined;
const settingsScrollEl = ref<HTMLElement | null>(null);
const settingsContentOverflowing = ref(false);
const settingsScrollSpacer = ref(0);
const settingsScrollbarThumbTop = ref(0);
let settingsScrollbarFrame: number | undefined;
const showMenu = ref(false);
let toolMenuCloseTimer: number | undefined;
let downloadStateDiskWriteTimer: number | undefined;
let devScriptProgressUnlisten: UnlistenFn | undefined;
let devScriptFinishedUnlisten: UnlistenFn | undefined;
let pendingDownloadStatePayload: PersistedDownloadState | null = null;
let restoredDiskDownloadState = false;
const leftCollapsed = ref(false);
const autoRepair = ref(typeof window === "undefined" || window.localStorage.getItem(AUTO_REPAIR_STORAGE_KEY) !== "0");
const GAME_DIRECTORY_NAME = "CrossingVoid";
const DEFAULT_LAUNCHER_ROOT = "D:\\TFAC-hz64";
const DEFAULT_GAME_INSTALL_PATH = `${DEFAULT_LAUNCHER_ROOT}\\${GAME_DIRECTORY_NAME}`;
const installPath = ref(savedDownloadState?.installPath || DEFAULT_GAME_INSTALL_PATH);
const selectedInstallBasePath = ref(savedDownloadState?.selectedInstallBasePath || DEFAULT_LAUNCHER_ROOT);
const createDesktopShortcut = ref(true);
const fallbackRequiredInstallBytes = 5 * 1024 * 1024 * 1024;
const remoteArchiveBytes = ref<number | null>(null);
const remoteArchivePending = ref(false);
const availableInstallBytes = ref<number | null>(null);
const availableSpacePending = ref(false);
const launcherLanguage = computed({
  get: () => languageLabels[currentLanguage.value],
  set: (label: string) => {
    currentLanguage.value = languageByLabel[label] ?? "zh-Hans";
  },
});
const downloadSources = [
  { key: "official", nameKey: "downloadSource.official", descriptionKey: "downloadSource.officialDesc" },
  { key: "github", nameKey: "downloadSource.github", descriptionKey: "downloadSource.githubDesc" },
] as const satisfies ReadonlyArray<{
  key: DownloadSourceKey;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
}>;
const updateManifestSources = {
  official: {
    backend: true,
  },
  github: {
    releaseAsset: "CrossingVoid-PC-update.json",
    legacyReleaseAsset: "update.json",
    releaseTagPrefix: "PC-",
    releaseProvider: "github",
  },
} as const satisfies Record<DownloadSourceKey, UpdateManifestSource>;
const officialUpdateApiUrl = "https://www.crossingvoid.top/api/toolbox-updates";
const remoteLauncherNoticeUrl = "https://www.crossingvoid.top/launcher-notice.json";
const officialProductKey = "crossingvoid-game";
const officialRuntime = "Windows";
const githubGameRepository = "kirito0000001/CrossingVoid";
const savedPreferredDownloadSource =
  typeof window === "undefined"
    ? null
    : window.localStorage.getItem(DOWNLOAD_SOURCE_STORAGE_KEY);
const downloadSource = ref<DownloadSourceKey>(
  normalizeDownloadSourceKey(
    savedDownloadState?.downloadSource ?? savedPreferredDownloadSource,
  ),
);
const closeToTray = ref(typeof window !== "undefined" && window.localStorage.getItem(CLOSE_TO_TRAY_STORAGE_KEY) === "1");
const hideAfterGameLaunch = ref(
  typeof window === "undefined" || window.localStorage.getItem(HIDE_AFTER_GAME_LAUNCH_STORAGE_KEY) !== "0",
);
const useDx11 = ref(typeof window !== "undefined" && window.localStorage.getItem(USE_DX11_STORAGE_KEY) === "1");
const downloadLimited = ref(typeof window !== "undefined" && window.localStorage.getItem(DOWNLOAD_LIMITED_STORAGE_KEY) === "1");
const speedLimit = ref(typeof window !== "undefined" ? window.localStorage.getItem(SPEED_LIMIT_STORAGE_KEY) || "1.0" : "1.0");
const downloadedMb = ref(bytesToMb(savedDownloadedBytes));
const downloadedBytes = ref(savedDownloadedBytes);
const activeDownloadBytes = ref<number | null>(savedTotalBytes || null);
const downloadPauseRequested = ref(false);
const repairOperationStage = ref<RepairOperationStage>("idle");
const repairDownloadPauseRequested = ref(false);
const gameOperationCancelRequested = ref(false);
const downloadTimeEstimator = new DownloadTimeEstimator();
const downloadEstimate = ref<DownloadEstimate>({ status: "calculating" });
const installProgressPercent = ref(0);
const installProgressStage = ref<"merging" | "verifying" | "extracting" | "finishing">("merging");
const installProgressItems = ref<{ current: number; total: number } | null>(null);
const repairProgressPercent = ref(0);
const repairProgressItems = ref<{ checked: number; total: number; repaired: number } | null>(null);
const verificationCurrentFile = ref("");
const verificationProcessedBytes = ref(0);
const verificationTotalBytes = ref(0);
const verificationCurrentFileBytes = ref(0);
const verificationCurrentFileTotalBytes = ref(0);
const installStage = ref<InstallStage>(
  savedDownloadState?.installStage === "merged" || savedDownloadState?.installStage === "extracting"
    ? savedDownloadState.installStage
    : "downloaded",
);
const totalMb = computed(() => bytesToMb(activeDownloadBytes.value ?? remoteArchiveBytes.value ?? fallbackRequiredInstallBytes));
const appWindow = getCurrentWindow();
let installProgressUnlisten: UnlistenFn | undefined;
let downloadProgressUnlisten: UnlistenFn | undefined;
let repairProgressUnlisten: UnlistenFn | undefined;
let gameProcessExitedUnlisten: UnlistenFn | undefined;
let windowFocusUnlisten: UnlistenFn | undefined;
let bootSplashTimer: number | undefined;
let downloadEstimateRefreshTimer: number | undefined;
const launcherLanguages = computed(() => languageOptions);
const fallbackCharacterProfiles: CharacterProfile[] = [
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
const characterProfiles = ref<CharacterProfile[]>(fallbackCharacterProfiles);
const activeCharacterProfile = computed(
  () => characterProfiles.value[activeCharacterBanner.value] ?? characterProfiles.value[0] ?? fallbackCharacterProfiles[0],
);
const currentCharacterBanner = computed(() => activeCharacterProfile.value.banner);
const fallbackNoticeBoard: NoticeBoard = {
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
const noticeBoard = ref<NoticeBoard>(fallbackNoticeBoard);
const fallbackVideos: VideoItem[] = [
  { title: "PV公开 | 空界幻境先导影像", date: "06-25", video: "" },
  { title: "实机演示 | 战斗系统与场景预览", date: "06-21", video: "" },
  { title: "开发记录 | 启动器界面制作过程", date: "06-19", video: "" },
];
const videos = ref<VideoItem[]>(fallbackVideos);
const activeVideo = ref<VideoItem | null>(null);
const videoFallbackBanner = "/launcher/video-fallback.png";
const t = (key: TranslationKey) => translations[currentLanguage.value][key] ?? translations["zh-Hans"][key] ?? key;
const developerVersionHint = computed(() => t("dev.versionHint").replace("{version}", launcherVersion.value));
const developerNoticeStatus = computed(() => {
  if (!developerNoticeLoaded.value) return "正在读取线上公告";
  const notice = remoteLauncherNotice.value;
  return notice?.enabled ? `线上公告已启用：${notice.title}` : "当前没有启用的远程公告";
});
const currentPromoBanner = computed(() => {
  if (activeNewsTab.value === "notice") return noticeBoard.value.banner;
  if (activeNewsTab.value === "video") return videoFallbackBanner;
  return currentCharacterBanner.value;
});
const currentPromoVideo = computed(() => (activeNewsTab.value === "video" ? activeVideo.value?.video : ""));
const currentEmbeddedVideo = computed(() => getEmbeddedVideoUrl(currentPromoVideo.value));
const currentDirectVideo = computed(() => (currentEmbeddedVideo.value ? "" : currentPromoVideo.value));
let characterBannerTimer: number | undefined;

function getEmbeddedVideoUrl(video: string | undefined) {
  if (!video) return "";

  const bv = video.match(/\/video\/(BV[a-zA-Z0-9]+)/i)?.[1] ?? video.match(/\b(BV[a-zA-Z0-9]+)\b/i)?.[1];
  if (!bv) return "";

  return `https://player.bilibili.com/player.html?bvid=${bv}&autoplay=1&muted=1&high_quality=1`;
}

function showNextCharacterBanner() {
  activeCharacterBanner.value = (activeCharacterBanner.value + 1) % characterProfiles.value.length;
}

function startCharacterBannerRotation() {
  if (characterBannerTimer) return;
  characterBannerTimer = window.setInterval(showNextCharacterBanner, 3000);
}

function stopCharacterBannerRotation() {
  if (!characterBannerTimer) return;
  window.clearInterval(characterBannerTimer);
  characterBannerTimer = undefined;
}

startCharacterBannerRotation();

onBeforeUnmount(() => {
  stopCharacterBannerRotation();
  if (settingsScrollbarFrame !== undefined) {
    window.cancelAnimationFrame(settingsScrollbarFrame);
    settingsScrollbarFrame = undefined;
  }
  if (downloadEstimateRefreshTimer !== undefined) {
    window.clearInterval(downloadEstimateRefreshTimer);
    downloadEstimateRefreshTimer = undefined;
  }
  if (downloadStateDiskWriteTimer !== undefined) {
    window.clearTimeout(downloadStateDiskWriteTimer);
    downloadStateDiskWriteTimer = undefined;
    const nextPayload = pendingDownloadStatePayload;
    pendingDownloadStatePayload = null;
    if (nextPayload?.installPath) {
      void invoke("write_download_state_file", { state: nextPayload }).catch((error) => {
        console.warn("Unable to flush download state file", error);
      });
    }
  }
  if (installProgressUnlisten) {
    installProgressUnlisten();
    installProgressUnlisten = undefined;
  }
  if (downloadProgressUnlisten) {
    downloadProgressUnlisten();
    downloadProgressUnlisten = undefined;
  }
  if (repairProgressUnlisten) {
    repairProgressUnlisten();
    repairProgressUnlisten = undefined;
  }
  if (devScriptProgressUnlisten) {
    devScriptProgressUnlisten();
    devScriptProgressUnlisten = undefined;
  }
  if (devScriptFinishedUnlisten) {
    devScriptFinishedUnlisten();
    devScriptFinishedUnlisten = undefined;
  }
  if (gameProcessExitedUnlisten) {
    gameProcessExitedUnlisten();
    gameProcessExitedUnlisten = undefined;
  }
  if (windowFocusUnlisten) {
    windowFocusUnlisten();
    windowFocusUnlisten = undefined;
  }
  if (lastCheckMessageTimer !== undefined) {
    window.clearTimeout(lastCheckMessageTimer);
    lastCheckMessageTimer = undefined;
  }
  if (bootSplashTimer !== undefined) {
    window.clearTimeout(bootSplashTimer);
    bootSplashTimer = undefined;
  }
  if (gameRunningPollTimer !== undefined) {
    stopGameRunningPolling();
  }
  if (trafficQuotaRefreshTimer !== undefined) {
    window.clearInterval(trafficQuotaRefreshTimer);
    trafficQuotaRefreshTimer = undefined;
  }
});

async function loadOnSetCharacters() {
  try {
    const payload = import.meta.env.DEV
      ? await fetchRemoteOnSetCharacters()
      : await loadBundledOnSetManifest();
    const sourceCharacters = payload.characters?.filter((item) => item.name) ?? [];
    const characters = await Promise.all(
      sourceCharacters.map(async (item, index) => {
        const fallback = fallbackCharacterProfiles[index % fallbackCharacterProfiles.length];
        const bannerReady = item.banner ? await preloadImage(item.banner, 3500) : false;
        if (item.banner && !bannerReady) {
          console.warn(`Character banner failed to load: ${item.banner}`);
        }
        return {
          name: item.name.trim() || fallback.name,
          work: item.work?.trim() || fallback.work,
          tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 4) : fallback.tags,
          banner: bannerReady ? item.banner : fallback.banner,
        };
      }),
    );
    if (!characters.length) return;

    characterProfiles.value = characters;
    activeCharacterBanner.value = Math.min(activeCharacterBanner.value, characters.length - 1);
  } catch {
    characterProfiles.value = fallbackCharacterProfiles;
  }
}

async function fetchRemoteOnSetCharacters() {
  const response = await fetch("/__cv_onset_characters");
  if (!response.ok) return { characters: [] };
  return (await response.json()) as { characters?: CharacterProfile[] };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForBootFonts(timeoutMs: number) {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  await Promise.race([
    document.fonts.ready.then(() => undefined).catch(() => undefined),
    wait(timeoutMs),
  ]);
}

function preloadImage(src: string | undefined, timeoutMs = 1800) {
  return new Promise<boolean>((resolve) => {
    if (!src || typeof Image === "undefined") {
      resolve(false);
      return;
    }

    const image = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(loaded);
    };

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

function handlePromoImageError() {
  if (activeNewsTab.value === "characters") {
    const index = activeCharacterBanner.value;
    const fallback = fallbackCharacterProfiles[index % fallbackCharacterProfiles.length];
    const current = characterProfiles.value[index];
    if (current && current.banner !== fallback.banner) {
      characterProfiles.value = characterProfiles.value.map((profile, profileIndex) =>
        profileIndex === index ? { ...profile, banner: fallback.banner } : profile,
      );
    }
    return;
  }

  if (activeNewsTab.value === "notice" && noticeBoard.value.banner !== fallbackNoticeBoard.banner) {
    noticeBoard.value = { ...noticeBoard.value, banner: fallbackNoticeBoard.banner };
  }
}

async function preloadBootImages() {
  const imageSources = new Set<string>();
  imageSources.add("/launcher/hero-bg.jpeg");
  imageSources.add("/launcher/logo_white.png");
  imageSources.add(videoFallbackBanner);
  imageSources.add(noticeBoard.value.banner);
  characterProfiles.value.forEach((profile) => imageSources.add(profile.banner));
  quickLinks.forEach((link) => {
    imageSources.add(link.iconSrc);
    if (link.qr) imageSources.add(link.qr);
  });

  await Promise.all([...imageSources].map((src) => preloadImage(src)));
}

async function loadBootResources() {
  bootSplashStatus.value = "读取主题配置";
  await loadOnSetColors();
  bootSplashStatus.value = "加载角色轮播";
  await loadOnSetCharacters();
  bootSplashStatus.value = "加载公告内容";
  await loadOnSetNoticeBoard();
  bootSplashStatus.value = "加载视频列表";
  await loadOnSetVideos();
  bootSplashStatus.value = "预载界面资源";
  await Promise.all([waitForBootFonts(1600), preloadBootImages()]);
}

function hideBootSplash() {
  if (keepBootSplashVisibleForLayout) return;
  if (bootSplashTimer !== undefined) {
    window.clearTimeout(bootSplashTimer);
  }
  bootSplashTimer = window.setTimeout(() => {
    bootSplashVisible.value = false;
    bootSplashTimer = undefined;
  }, 120);
}

onMounted(() => {
  document.body.classList.add("launcher-app-mounted");
  downloadEstimateRefreshTimer = window.setInterval(() => {
    if (launcherState.value !== "downloading") return;
    downloadEstimate.value = downloadTimeEstimator.getEstimate(performance.now());
  }, 1_000);
  void (async () => {
    const bootStartedAt = performance.now();
    try {
      bootSplashStatus.value = "读取本地状态";
      gameProcessExitedUnlisten = await listen("game-process-exited", async () => {
        gameRunning.value = false;
        gameLaunchPending.value = false;
        if (hideAfterGameLaunch.value) return;
        await showLauncherWindow();
      });
      await refreshDeveloperLauncherVersion();
      const diskStateRestored = await restoreDownloadStateFromDisk();
      if (!diskStateRestored) {
        await validateCurrentPersistedState();
      }
      await restoreReadyInstallFromFiles();
      await readLocalGameVersion();
      await refreshGameRunningState();
      windowFocusUnlisten = await appWindow.onFocusChanged((event) => {
        if (event.payload) void refreshExternalInstallState();
      });
      await Promise.all([refreshTrafficQuota(), refreshRemoteLauncherNotice()]);
      await nextTick();

      bootSplashStatus.value = "准备界面资源";
      await Promise.all([wait(Math.max(0, 900 - (performance.now() - bootStartedAt))), loadBootResources()]);
    } catch (error) {
      console.warn("Launcher boot initialization failed", error);
    } finally {
      hideBootSplash();
      if (trafficQuotaRefreshTimer === undefined) {
        trafficQuotaRefreshTimer = window.setInterval(() => void refreshTrafficQuota(), 5 * 60 * 1000);
      }
      void checkUpdatesInOrder({ manual: false });
    }
  })();
});

function isCssColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

async function loadOnSetColors() {
  try {
    const payload = import.meta.env.DEV
      ? await fetchRemoteOnSetColors()
      : await loadBundledOnSetManifest();
    const colors = payload.colors;
    const rootStyle = document.documentElement.style;
    if (!colors) return;
    const accent = colors.accent;
    const support = colors.support;

    if (isCssColor(accent)) {
      rootStyle.setProperty("--cv-theme-accent", accent.trim());
    }

    if (isCssColor(support)) {
      rootStyle.setProperty("--cv-theme-support", support.trim());
    }
  } catch {
    document.documentElement.style.removeProperty("--cv-theme-accent");
    document.documentElement.style.removeProperty("--cv-theme-support");
  }
}

async function loadOnSetNoticeBoard() {
  try {
    const payload = import.meta.env.DEV
      ? await fetchRemoteOnSetNoticeBoard()
      : await loadBundledOnSetManifest();
    if (!payload.notice?.banner || !payload.notice.sections?.length) return;

    noticeBoard.value = payload.notice;
  } catch {
    noticeBoard.value = fallbackNoticeBoard;
  }
}

async function loadOnSetVideos() {
  try {
    const payload = import.meta.env.DEV
      ? await fetchRemoteOnSetVideos()
      : await loadBundledOnSetManifest();
    const nextVideos = payload.videos?.filter((item) => item.title) ?? [];
    if (!nextVideos.length) return;

    videos.value = nextVideos;
    activeVideo.value = nextVideos[0] ?? null;
  } catch {
    videos.value = fallbackVideos;
  }
}

async function loadBundledOnSetManifest() {
  if (bundledOnSetManifest.value) return bundledOnSetManifest.value;
  const response = await fetch("OnSet/onset-manifest.json");
  if (!response.ok) return {};
  bundledOnSetManifest.value = (await response.json()) as OnSetManifest;
  return bundledOnSetManifest.value;
}

async function fetchRemoteOnSetColors() {
  const response = await fetch("/__cv_onset_colors");
  if (!response.ok) return { colors: null };
  return (await response.json()) as { colors?: ThemeColors | null };
}

async function fetchRemoteOnSetNoticeBoard() {
  const response = await fetch("/__cv_onset_notice_board");
  if (!response.ok) return { notice: null };
  return (await response.json()) as { notice?: NoticeBoard | null };
}

async function fetchRemoteOnSetVideos() {
  const response = await fetch("/__cv_onset_videos");
  if (!response.ok) return { videos: [] };
  return (await response.json()) as { videos?: VideoItem[] };
}

const progressPercent = computed(() =>
  developerTaskActive.value
    ? developerTaskProgressPercent.value
    : launcherUpdateActive.value
    ? launcherUpdateProgressPercent.value
    : launcherUpdateConfirmStage.value === "available"
    ? 100
    : versionCheckPending.value
    ? 100
    : launcherState.value === "repairPending"
    ? 100
    : launcherState.value === "checking"
    ? Math.min(100, Number(repairProgressPercent.value.toFixed(2)))
    : launcherState.value === "repairing"
    ? Math.min(100, Number(repairProgressPercent.value.toFixed(2)))
    : launcherState.value === "installing"
    ? Math.min(100, Number(installProgressPercent.value.toFixed(2)))
    : Math.min(100, Number(((downloadedMb.value / Math.max(totalMb.value, 0.1)) * 100).toFixed(2))),
);
const hasCompleteDownloadedArchive = computed(() => {
  const totalBytes = activeDownloadBytes.value ?? remoteArchiveBytes.value ?? 0;
  return launcherState.value !== "ready" && totalBytes > 0 && downloadedBytes.value >= totalBytes;
});
const offlinePlayable = computed(() => offlineMode.value && Boolean(localGameVersion.value));
const showDownloadProgress = computed(() =>
  developerTaskActive.value ||
  launcherUpdateActive.value ||
  launcherUpdateConfirmStage.value === "available" ||
  (!offlinePlayable.value &&
  (versionCheckPending.value ||
    launcherState.value === "downloading" ||
    launcherState.value === "downloaded" ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairPending" ||
    launcherState.value === "repairing" ||
    (launcherState.value === "ready" && updateAvailable.value && !offlineMode.value) ||
    (launcherState.value === "paused" && downloadedMb.value > 0))),
);
const showProgressNumbers = computed(
  () =>
    developerTaskActive.value ||
    launcherUpdateActive.value ||
    launcherUpdateConfirmStage.value === "available" ||
    (!versionCheckPending.value && !(launcherState.value === "ready" && updateAvailable.value && !offlineMode.value)),
);
const showProgressTrack = computed(() =>
  developerTaskActive.value ||
  launcherUpdateActive.value ||
  launcherUpdateConfirmStage.value === "available" ||
  (showProgressNumbers.value && !(launcherState.value === "ready" && updateAvailable.value && !offlineMode.value)),
);
const compactStatusLine = computed(
  () =>
    !developerTaskActive.value &&
    !launcherUpdateActive.value &&
    launcherUpdateConfirmStage.value !== "available" &&
    (versionCheckPending.value || (launcherState.value === "ready" && updateAvailable.value && !offlineMode.value)),
);
const developerGameUploadActive = computed(
  () => developerTaskKind.value === "game-windows" || developerTaskKind.value === "game-android",
);
const canPauseDeveloperUpload = computed(
  () => developerGameUploadActive.value && developerTaskPending.value && !developerTaskPauseRequested.value,
);
const canResumeDeveloperUpload = computed(
  () => developerGameUploadActive.value && developerTaskPaused.value && !developerTaskPending.value,
);
const canPauseRepairDownload = computed(
  () =>
    launcherState.value === "repairing" &&
    repairOperationStage.value === "downloading" &&
    !repairDownloadPauseRequested.value &&
    !gameOperationCancelRequested.value,
);
const canCancelCurrentGameOperation = computed(
  () =>
    !gameOperationCancelRequested.value &&
    ((launcherState.value === "installing") ||
      (launcherState.value === "checking" && repairOperationStage.value === "verifying") ||
      (launcherState.value === "repairing" && repairOperationStage.value !== "downloading")),
);
const hasPrimaryOperationControl = computed(
  () =>
    canPauseDeveloperUpload.value ||
    canResumeDeveloperUpload.value ||
    canPauseRepairDownload.value ||
    canCancelCurrentGameOperation.value,
);
const primaryActionDisabled = computed(
  () =>
    (launcherUpdateActive.value && launcherUpdateStage.value !== "checking") ||
    (developerTaskActive.value && !hasPrimaryOperationControl.value) ||
    gameLaunchPending.value ||
    gameRunning.value ||
    ((launcherState.value === "installing" || launcherState.value === "checking" || launcherState.value === "repairing") &&
      !hasPrimaryOperationControl.value) ||
    versionCheckPending.value,
);
const menuActionDisabled = computed(
  () =>
    launcherUpdateActive.value ||
    developerTaskActive.value ||
    gameLaunchPending.value ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairing",
);
const gameSettingsDisabled = computed(
  () =>
    launcherUpdateActive.value ||
    developerTaskActive.value ||
    gameLaunchPending.value ||
    launcherState.value === "downloading" ||
    launcherState.value === "downloaded" ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairPending" ||
    launcherState.value === "repairing" ||
    (launcherState.value === "paused" && downloadedBytes.value > 0),
);
const downloadSourceDisabled = computed(
  () =>
    launcherUpdateActive.value ||
    developerTaskActive.value ||
    launcherState.value === "downloading" ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairing",
);

function developerTaskStatus(kind: DeveloperTaskKind) {
  if (kind === "game-windows") return "上传 PC 游戏包中";
  if (kind === "game-android") return "上传 Android 游戏包中";
  if (kind === "publish") return "发布启动器中";
  return "打包启动器中";
}

const actionCopy = computed(() => {
  if (developerGameUploadActive.value) {
    if (developerTaskPauseRequested.value) return "正在暂停上传";
    if (developerTaskPaused.value) return t("action.resumeUpload");
    return t("action.pauseUpload");
  }
  if (developerTaskActive.value) return developerTaskStatus(developerTaskKind.value);
  if (launcherUpdateActive.value) return t("action.updateLauncher");
  if (launcherUpdateConfirmStage.value === "available") return t("action.updateLauncherReady");
  if (gameLaunchPending.value) return t("action.launchingGame");
  if (gameRunning.value) return t("action.gameRunning");
  if (offlinePlayable.value) return t("action.launchGame");
  if (versionCheckPending.value) return t("status.versionChecking");
  if (repairDownloadPauseRequested.value) return "正在暂停";
  if (gameOperationCancelRequested.value) return t("action.cancelling");
  if (canPauseRepairDownload.value) return t("action.pauseDownload");
  if (launcherState.value === "installing" && canCancelCurrentGameOperation.value) return t("action.cancelInstall");
  if (launcherState.value === "checking" && canCancelCurrentGameOperation.value) return t("action.cancelVerification");
  if (launcherState.value === "repairing" && canCancelCurrentGameOperation.value) return t("action.cancelRepair");
  if (launcherState.value === "checking") return t("action.checking");
  if (launcherState.value === "repairPending") return t("action.repairFiles");
  if (launcherState.value === "repairing") return t("status.repairingFiles");
  if (launcherState.value === "installing") return t("action.installing");
  if (launcherState.value === "downloading") return t("action.pauseDownload");
  if (launcherState.value === "ready" && updateAvailable.value && !offlineMode.value) return t("action.updateGame");
  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) return t("action.installGame");
  if (launcherState.value === "ready") return t("action.launchGame");
  if (updateDownloadPending.value) return t("action.resumeDownload");
  return downloadedMb.value > 0 ? t("action.resumeDownload") : t("action.downloadGame");
});

const actionIcon = computed(() => {
  if (developerTaskPauseRequested.value || repairDownloadPauseRequested.value) return Pause;
  if (canPauseDeveloperUpload.value || canPauseRepairDownload.value) return Pause;
  if (canResumeDeveloperUpload.value) return Download;
  if (gameOperationCancelRequested.value || canCancelCurrentGameOperation.value) return X;
  if (developerTaskActive.value) return RefreshCw;
  if (launcherUpdateActive.value) return RefreshCw;
  if (launcherUpdateConfirmStage.value === "available") return HardDriveDownload;
  if (gameLaunchPending.value) return RefreshCw;
  if (gameRunning.value) return Gamepad2;
  if (offlinePlayable.value) return Gamepad2;
  if (launcherState.value === "downloading") return Pause;
  if (launcherState.value === "repairPending") return CircleAlert;
  if (versionCheckPending.value || launcherState.value === "checking" || launcherState.value === "installing" || launcherState.value === "repairing") return RefreshCw;
  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) return PackageOpen;
  if (launcherState.value === "ready" && updateAvailable.value && !offlineMode.value) return HardDriveDownload;
  if (launcherState.value === "ready") return Gamepad2;
  return Download;
});

const primaryActionSpinning = computed(() => {
  if (
    hasPrimaryOperationControl.value ||
    developerTaskPauseRequested.value ||
    repairDownloadPauseRequested.value ||
    gameOperationCancelRequested.value
  )
    return false;
  return (
    launcherUpdateActive.value ||
    (developerTaskActive.value && !developerGameUploadActive.value) ||
    gameLaunchPending.value ||
    versionCheckPending.value ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairing"
  );
});

const detailedVerificationActive = computed(
  () =>
    launcherState.value === "checking" ||
    (launcherState.value === "repairing" && repairOperationStage.value === "verifying"),
);
const verificationCurrentFileName = computed(() => {
  const parts = verificationCurrentFile.value.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
});
const verificationFileTitle = computed(() => {
  if (!verificationCurrentFile.value) return "";
  if (verificationCurrentFileTotalBytes.value <= 0) return verificationCurrentFile.value;
  return `${verificationCurrentFile.value} · ${formatBytes(verificationCurrentFileBytes.value)}/${formatBytes(verificationCurrentFileTotalBytes.value)}`;
});
const verificationByteProgress = computed(() => {
  if (!detailedVerificationActive.value || verificationTotalBytes.value <= 0) return "";
  return `${formatBytes(verificationProcessedBytes.value)}/${formatBytes(verificationTotalBytes.value)}`;
});
const verificationIssueCopy = computed(() => {
  if (!detailedVerificationActive.value) return "";
  const count = Math.max(0, repairProgressItems.value?.repaired ?? 0);
  return count > 0 ? t("status.verificationIssues").replace("{count}", String(count)) : "";
});

const statusCopy = computed(() => {
  if (developerTaskPaused.value && developerGameUploadActive.value) return "上传已暂停";
  if (developerTaskActive.value) return developerTaskStatus(developerTaskKind.value);
  if (launcherUpdateActive.value) return launcherUpdateStatusCopy.value;
  if (launcherUpdateConfirmStage.value === "available") {
    return launcherUpdateVersion.value ? `${t("status.launcherUpdateAvailable")} ${launcherUpdateVersion.value}` : t("status.launcherUpdateAvailable");
  }
  if (gameLaunchPending.value) return t("status.launchingGame");
  if (gameRunning.value) return t("status.gameRunning");
  if (offlinePlayable.value) return t("status.ready");
  if (versionCheckPending.value) return t("status.versionChecking");
  if (detailedVerificationActive.value && verificationCurrentFileName.value) {
    return t("status.checkingFile").replace("{file}", verificationCurrentFileName.value);
  }
  if (launcherState.value === "checking") return t("status.checking");
  if (launcherState.value === "repairPending") return t("status.filesMissing");
  if (launcherState.value === "repairing") {
    if (repairOperationStage.value === "preparing") return t("status.repairPreparing");
    if (repairOperationStage.value === "downloading") return t("status.repairDownloading");
    if (repairOperationStage.value === "repairing") return t("status.repairWriting");
    if (repairOperationStage.value === "verifying") return t("status.repairVerifying");
    return t("status.repairingFiles");
  }
  if (launcherState.value === "installing") return t(`installStage.${installProgressStage.value}` as TranslationKey);
  if (launcherState.value === "ready" && updateAvailable.value && !offlineMode.value) {
    return remoteGameVersion.value ? `${t("status.updateAvailable")} ${remoteGameVersion.value}` : t("status.updateAvailable");
  }
  if (launcherState.value === "downloading") return t("status.downloading");
  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) return t("status.downloaded");
  if (launcherState.value === "ready") return t("status.ready");
  if (updateDownloadPending.value) return t("status.paused");
  return downloadedMb.value > 0 ? t("status.paused") : t("status.waiting");
});
const downloadEstimateCopy = computed(() => {
  if (launcherState.value !== "downloading") return "";
  if (downloadEstimate.value.status === "stalled") return "网络不佳";
  if (downloadEstimate.value.status !== "ready") return "--:--";
  return formatEtaClock(downloadEstimate.value.remainingSeconds) ?? "网络不佳";
});
const displayedProgressMb = computed(() => (launcherState.value === "installing" ? totalMb.value : downloadedMb.value));
const developerTaskActive = computed(() => developerTaskKind.value !== "idle");
const developerTaskProgressPercent = computed(() => Math.min(100, Math.max(1, Number(developerTaskPercent.value.toFixed(2)))));
const developerTaskProgressDetail = computed(() => developerTaskMessage.value);
const launcherUpdateActive = computed(() => launcherUpdateStage.value !== "idle" && launcherUpdateStage.value !== "failed");
const launcherUpdateProgressPercent = computed(() => {
  if (launcherUpdateStage.value === "checking") return 12;
  if (launcherUpdateStage.value === "installing") return 85;
  if (launcherUpdateStage.value === "restarting") return 100;
  if (launcherUpdateTotalBytes.value > 0) {
    const downloadRatio = Math.min(1, Math.max(0, launcherUpdateDownloadedBytes.value / launcherUpdateTotalBytes.value));
    return Math.min(70, Math.max(1, Number((downloadRatio * 70).toFixed(2))));
  }
  return launcherUpdateStage.value === "downloading" ? 18 : 0;
});
const launcherUpdateStatusCopy = computed(() => {
  if (launcherUpdateStage.value === "checking") return t("status.launcherUpdateChecking");
  if (launcherUpdateStage.value === "installing") return t("status.launcherUpdateInstalling");
  if (launcherUpdateStage.value === "restarting") return t("status.launcherUpdateRestarting");
  return launcherUpdateVersion.value
    ? `${t("status.launcherUpdateDownloading")} ${launcherUpdateVersion.value}`
    : t("status.launcherUpdateDownloading");
});
const launcherUpdateProgressDetail = computed(() => {
  if (launcherUpdateStage.value !== "downloading" || launcherUpdateTotalBytes.value <= 0) return "";
  return `${formatBytes(launcherUpdateDownloadedBytes.value)}/${formatBytes(launcherUpdateTotalBytes.value)}`;
});
const installProgressDetail = computed(() => {
  if (launcherState.value !== "installing") return "";
  if (installProgressItems.value && installProgressItems.value.total > 0) {
    return `${installProgressItems.value.current}/${installProgressItems.value.total}`;
  }
  return "";
});
const repairProgressDetail = computed(() => {
  if (launcherState.value === "repairPending" && pendingRepairSummary.value) {
    const total = Math.max(0, pendingRepairSummary.value.checkedFiles || 0);
    const missing = Math.max(0, pendingRepairSummary.value.missingFiles || pendingRepairSummary.value.invalidFiles || 0);
    const current = Math.max(0, total - missing);
    return `${current}/${total}`;
  }
  if (launcherState.value === "repairing") {
    if (repairOperationStage.value === "preparing") return "读取修复清单";
    if (repairOperationStage.value === "downloading") {
      const totalBytes = activeDownloadBytes.value ?? remoteArchiveBytes.value ?? 0;
      return totalBytes > 0
        ? `${formatBytes(downloadedBytes.value)}/${formatBytes(totalBytes)}`
        : formatBytes(downloadedBytes.value);
    }
    if (repairProgressItems.value && repairProgressItems.value.total > 0) {
      const progress = `${repairProgressItems.value.checked}/${repairProgressItems.value.total}`;
      return repairOperationStage.value === "repairing"
        ? `已修复 ${repairProgressItems.value.repaired} · ${progress}`
        : `已校验 ${progress}`;
    }
    if (repairOperationStage.value === "repairing") return "逐项写入异常文件";
    if (repairOperationStage.value === "verifying") return "重新校验全部文件";
  }
  if (
    (launcherState.value !== "checking" && launcherState.value !== "repairing") ||
    !repairProgressItems.value ||
    repairProgressItems.value.total <= 0
  )
    return "";
  return `${repairProgressItems.value.checked}/${repairProgressItems.value.total}`;
});
const repairMissingDetail = computed(() => {
  if (launcherState.value !== "repairPending" || !pendingRepairSummary.value) return "";
  const missing = Math.max(0, pendingRepairSummary.value.missingFiles || pendingRepairSummary.value.invalidFiles || 0);
  return `(${missing})`;
});
const displayedGameVersion = computed(() => localGameVersion.value || remoteGameVersion.value || "-");
const hasLocalInstalledGame = computed(() => launcherState.value === "ready" || Boolean(localGameVersion.value));
const hasActiveDownloadTask = computed(
  () =>
    launcherState.value === "downloading" ||
    launcherState.value === "downloaded" ||
    launcherState.value === "installing" ||
    updateDownloadPending.value ||
    (launcherState.value === "paused" && downloadedBytes.value > 0 && !offlinePlayable.value),
);
const canCheckGameUpdates = computed(() => hasLocalInstalledGame.value && !hasActiveDownloadTask.value);
const canVerifyGameIntegrity = computed(
  () =>
    !hasActiveDownloadTask.value &&
    launcherState.value !== "checking" &&
    launcherState.value !== "repairing",
);
const finalInstallPath = computed(() => buildFinalInstallPath(selectedInstallBasePath.value));
const availableSpaceCopy = computed(() => {
  if (availableSpacePending.value) return t("space.checking");
  if (availableInstallBytes.value == null) return t("space.unavailable");
  return formatBytes(availableInstallBytes.value);
});
const requiredInstallBytes = computed(() => (remoteArchiveBytes.value ?? fallbackRequiredInstallBytes) * 2);
const requiredSpaceCopy = computed(() => {
  if (remoteArchivePending.value && remoteArchiveBytes.value == null) return t("space.querying");
  return formatBytes(requiredInstallBytes.value);
});
const isInstallSpaceLow = computed(
  () => availableInstallBytes.value != null && availableInstallBytes.value < requiredInstallBytes.value,
);

function cancelToolMenuClose() {
  if (toolMenuCloseTimer) {
    window.clearTimeout(toolMenuCloseTimer);
    toolMenuCloseTimer = undefined;
  }
}

function toggleToolMenu() {
  if (menuActionDisabled.value) return;
  cancelToolMenuClose();
  showMenu.value = !showMenu.value;
}

function scheduleToolMenuClose() {
  cancelToolMenuClose();
  toolMenuCloseTimer = window.setTimeout(() => {
    showMenu.value = false;
    toolMenuCloseTimer = undefined;
  }, 180);
}

const news = {
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
const newsTabs = [
  { key: "characters", labelKey: "news.characters" },
  { key: "notice", labelKey: "news.notice" },
  { key: "video", labelKey: "news.video" },
] as const satisfies ReadonlyArray<{ key: NewsTab; labelKey: TranslationKey }>;
const activeNewsItems = computed(() => (activeNewsTab.value === "video" ? videos.value : news[activeNewsTab.value as keyof typeof news] ?? []));

const quickLinks: QuickLink[] = [
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

const settingsTabs = [
  { key: "preferences", labelKey: "settings.preferences", icon: Settings },
  { key: "download", labelKey: "settings.download", icon: Download },
  { key: "game", labelKey: "settings.game", icon: Gamepad2 },
  { key: "about", labelKey: "settings.about", icon: Info },
  ...(import.meta.env.DEV ? [{ key: "developer" as const, labelKey: "settings.developer" as const, icon: Wrench }] : []),
] satisfies Array<{ key: SettingsTab; labelKey: TranslationKey; icon: typeof Settings }>;

const settingsTitle = computed(() => {
  const current = settingsTabs.find((item) => item.key === activeSettingsTab.value);
  return current ? t(current.labelKey) : t("settings.preferences");
});

function selectSettingsTab(tab: SettingsTab) {
  if (tab === "game" && gameSettingsDisabled.value) return;
  activeSettingsTab.value = tab;
  if (tab === "developer") {
    void refreshDeveloperRemoteNotice();
  }
}

const selectedDownloadSource = computed(
  () => downloadSources.find((source) => source.key === downloadSource.value) ?? downloadSources[0],
);
const selectedDownloadSourceDescription = computed(() => t(selectedDownloadSource.value.descriptionKey));
const officialTrafficBlocked = computed(
  () => Boolean(trafficQuota.value?.available && !trafficQuota.value.downloadAllowed),
);
const showOfficialTrafficWarning = computed(
  () => downloadSource.value === "official" && officialTrafficBlocked.value,
);
const trafficQuotaPercent = computed(() => {
  const quota = trafficQuota.value;
  if (!quota?.available || quota.totalBytes <= 0) return 0;
  return Math.max(0, Math.min(100, (quota.remainingBytes / quota.totalBytes) * 100));
});
const trafficQuotaRemainingText = computed(() => {
  const quota = trafficQuota.value;
  if (trafficQuotaPending.value && !quota) return t("traffic.updating");
  if (!quota?.available) return t("traffic.unavailable");
  return `${t("traffic.remaining")} ${formatBytes(quota.remainingBytes)} / ${formatBytes(quota.totalBytes)}`;
});
const trafficQuotaExpiryText = computed(() => {
  const expiresAt = trafficQuota.value?.expiresAt;
  if (!expiresAt) return "";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${t("traffic.expires")} ${new Intl.DateTimeFormat(currentLanguage.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)}`;
});
const downloadSourceNameByKey = computed(() =>
  Object.fromEntries(downloadSources.map((source) => [source.key, t(source.nameKey)])) as Record<DownloadSourceKey, string>,
);
const downloadSourceKeyByName = computed(() =>
  Object.fromEntries(downloadSources.map((source) => [t(source.nameKey), source.key])) as Record<string, DownloadSourceKey>,
);
const downloadSourceModel = computed({
  get: () => downloadSourceNameByKey.value[downloadSource.value],
  set: (label: string) => {
    downloadSource.value = downloadSourceKeyByName.value[label] ?? "official";
  },
});
const downloadSourceOptions = computed(() => downloadSources.map((source) => t(source.nameKey)));
const settingsScrollbarFrameStyle = computed(() => ({
  top: `${SETTINGS_SCROLLBAR.railTop}px`,
  bottom: `${SETTINGS_SCROLLBAR.railBottom}px`,
}));
const showSettingsScrollbar = computed(() => Boolean(showSettings.value && settingsContentOverflowing.value));

function updateSettingsScrollbar() {
  const scrollEl = settingsScrollEl.value;
  const pageEl =
    scrollEl?.querySelector<HTMLElement>(`[data-settings-page="${activeSettingsTab.value}"]`) ??
    scrollEl?.querySelector<HTMLElement>(".settings-page");
  const modalEl = scrollEl?.closest<HTMLElement>(".settings-modal");
  const modalRect = modalEl?.getBoundingClientRect();
  const pageRect = pageEl?.getBoundingClientRect();
  const visualViewportHeight = scrollEl
    ? Math.max(0, scrollEl.clientHeight - (SETTINGS_SCROLLBAR.viewportBottomInset - SETTINGS_SCROLLBAR.frameBottomOffset))
    : 0;
  const overflowAmount =
    pageRect && visualViewportHeight
      ? Math.max(0, Math.ceil(pageRect.height - visualViewportHeight))
      : 0;
  const visuallyOverflowing = Boolean(
    overflowAmount > 0,
  );
  const nativeOverflowing = Boolean(scrollEl && pageEl && pageEl.scrollHeight > scrollEl.clientHeight + 2);
  const shouldShowVisualScrollbar = visuallyOverflowing || nativeOverflowing;
  settingsContentOverflowing.value = Boolean(showSettings.value && scrollEl && shouldShowVisualScrollbar);
  settingsScrollSpacer.value = visuallyOverflowing ? overflowAmount + SETTINGS_SCROLLBAR.extraScrollSpace : 0;
  const maxScroll = scrollEl ? scrollEl.scrollHeight - scrollEl.clientHeight : 0;
  const railTravel = modalRect
    ? Math.max(0, modalRect.height - SETTINGS_SCROLLBAR.railTop - SETTINGS_SCROLLBAR.railBottom) *
      (1 - SETTINGS_SCROLLBAR.thumbVisibleRatio)
    : 0;
  settingsScrollbarThumbTop.value =
    showSettingsScrollbar.value && maxScroll > 0
      ? Math.min(railTravel, Math.max(0, scrollEl!.scrollTop / maxScroll) * railTravel)
      : 0;
}

function resetSettingsScrollbar() {
  settingsScrollSpacer.value = 0;
  settingsScrollbarThumbTop.value = 0;
  settingsContentOverflowing.value = false;
}

watch([showSettings, activeSettingsTab], () => {
  resetSettingsScrollbar();
  if (showSettings.value && activeSettingsTab.value === "download") {
    void refreshTrafficQuota();
  }
  scheduleSettingsScrollbarUpdate();
});

watch(gameSettingsDisabled, (disabled) => {
  if (disabled && activeSettingsTab.value === "game") {
    activeSettingsTab.value = "preferences";
  }
});

watch(currentLanguage, (language) => {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  document.documentElement.lang = language;
});

watch(downloadSource, (source) => {
  window.localStorage.setItem(DOWNLOAD_SOURCE_STORAGE_KEY, source);
}, { flush: "sync" });

watch(downloadLimited, (limited) => {
  window.localStorage.setItem(DOWNLOAD_LIMITED_STORAGE_KEY, limited ? "1" : "0");
  syncDownloadSpeedLimit();
});

watch(speedLimit, (limit) => {
  window.localStorage.setItem(SPEED_LIMIT_STORAGE_KEY, limit);
  if (downloadLimited.value) syncDownloadSpeedLimit();
});

watch(useDx11, (enabled) => {
  window.localStorage.setItem(USE_DX11_STORAGE_KEY, enabled ? "1" : "0");
});

watch(closeToTray, (enabled) => {
  window.localStorage.setItem(CLOSE_TO_TRAY_STORAGE_KEY, enabled ? "1" : "0");
});

watch(autoRepair, (enabled) => {
  window.localStorage.setItem(AUTO_REPAIR_STORAGE_KEY, enabled ? "1" : "0");
});

watch(hideAfterGameLaunch, (enabled) => {
  window.localStorage.setItem(HIDE_AFTER_GAME_LAUNCH_STORAGE_KEY, enabled ? "1" : "0");
});

watch([gameRunning, gameLaunchPending], () => {
  syncGameRunningPolling();
});

watch(developerPackagePath, (path) => {
  if (!path.trim()) return;
  window.localStorage.setItem(DEV_PACKAGE_PATH_STORAGE_KEY, path);
});

watch(developerGameVersion, (version) => {
  window.localStorage.setItem(DEV_GAME_VERSION_STORAGE_KEY, version);
});

watch(developerGameTitle, (title) => {
  window.localStorage.setItem(DEV_GAME_TITLE_STORAGE_KEY, title);
});

watch([installPath, selectedInstallBasePath, downloadSource], () => {
  persistDownloadState(currentPersistableState(), "immediate");
});

watch([showInstallConfirm, finalInstallPath], ([visible]) => {
  if (!visible) return;
  void updateAvailableInstallSpace();
});

watch([showInstallConfirm, downloadSource], ([visible]) => {
  if (!visible) return;
  void updateRemoteArchiveInfo();
});

function buildFinalInstallPath(basePath: string) {
  const normalized = basePath.trim();
  if (!normalized) return DEFAULT_GAME_INSTALL_PATH;
  if (new RegExp(`${GAME_DIRECTORY_NAME}[\\\\/]?$`, "i").test(normalized)) return normalized.replace(/[\\/]$/, "");
  return `${normalized.replace(/[\\/]$/, "")}\\${GAME_DIRECTORY_NAME}`;
}

function inferInstallBasePathFromGamePath(gamePath: string) {
  const normalized = gamePath.trim().replace(/[\\/]$/, "");
  if (!normalized) return DEFAULT_LAUNCHER_ROOT;
  if (!new RegExp(`${GAME_DIRECTORY_NAME}$`, "i").test(normalized)) return normalized;
  const parent = normalized.replace(new RegExp(`[\\\\/]${GAME_DIRECTORY_NAME}$`, "i"), "");
  return parent || normalized;
}

function formatBytes(bytes: number) {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  const gb = mb / 1024;

  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)}GB`;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 1 : 2)}MB`;
  if (kb >= 1) return `${kb.toFixed(kb >= 10 ? 1 : 2)}KB`;
  return `${Math.max(0, Math.round(bytes))}B`;
}

function bytesToMb(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}

function getDownloadSpeedLimitBytes() {
  if (!downloadLimited.value) return null;
  const parsed = Number.parseFloat(speedLimit.value);
  const mbPerSecond = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 1;
  speedLimit.value = mbPerSecond.toFixed(1);
  return Math.round(mbPerSecond * 1024 * 1024);
}

function syncDownloadSpeedLimit() {
  void invoke("set_download_speed_limit", {
    speedLimitBytesPerSecond: getDownloadSpeedLimitBytes(),
  }).catch((error) => {
    console.warn("Unable to update download speed limit", error);
  });
}

function applyPersistedDownloadState(state: PersistedDownloadState) {
  const persistedDownloadedBytes = persistedNumber(state.downloadedBytes);
  const persistedTotalBytes = persistedNumber(state.totalBytes);
  if (state.installPath) installPath.value = state.installPath;
  if (state.selectedInstallBasePath) selectedInstallBasePath.value = state.selectedInstallBasePath;
  if (isDownloadSourceKey(state.downloadSource)) {
    downloadSource.value = state.downloadSource;
  }
  updateDownloadPending.value = state.mode === "update";
  downloadedBytes.value = persistedDownloadedBytes;
  downloadedMb.value = bytesToMb(persistedDownloadedBytes);
  activeDownloadBytes.value = persistedTotalBytes || null;
  remoteArchiveBytes.value = persistedTotalBytes || remoteArchiveBytes.value;
  installStage.value =
    state.installStage === "merged" || state.installStage === "extracting" ? state.installStage : "downloaded";
  launcherState.value = normalizePersistedState(state);
  if (launcherState.value === "repairPending") {
    pendingRepairSummary.value = { checkedFiles: 1, invalidFiles: 1, missingFiles: 1 };
  }
}

function scheduleSettingsScrollbarUpdate() {
  if (settingsScrollbarFrame !== undefined) {
    window.cancelAnimationFrame(settingsScrollbarFrame);
  }
  void nextTick(() => {
    settingsScrollbarFrame = window.requestAnimationFrame(() => {
      settingsScrollbarFrame = undefined;
      updateSettingsScrollbar();
    });
  });
}

async function validatePersistedDownloadState(state: PersistedDownloadState) {
  const targetPath = state.installPath || DEFAULT_GAME_INSTALL_PATH;
  if (state.mode === "repair") {
    try {
      return await invoke<boolean>("validate_game_install_state", {
        installPath: targetPath,
        state: "repairable",
      });
    } catch (error) {
      console.warn("Unable to validate repair target", error);
      return false;
    }
  }
  if (state.mode === "update" && state.state !== "ready") {
    try {
      return await invoke<boolean>("validate_game_install_state", {
        installPath: targetPath,
        state: "ready",
      });
    } catch (error) {
      console.warn("Unable to validate update target", error);
      return false;
    }
  }
  const targetState = state.state === "ready" ? "ready" : "paused";
  if (targetState === "paused" && persistedNumber(state.downloadedBytes) <= 0) return false;
  try {
    return await invoke<boolean>("validate_game_install_state", {
      installPath: targetPath,
      state: targetState,
    });
  } catch (error) {
    console.warn("Unable to validate install state", error);
    return false;
  }
}

async function restoreReadyInstallFromFiles() {
  try {
    const isReady = await invoke<boolean>("validate_game_install_state", {
      installPath: installPath.value,
      state: "ready",
    });
    if (
      !canPromoteInstalledGame({
        installFilesReady: isReady,
        launcherState: launcherState.value,
        updateDownloadPending: updateDownloadPending.value,
        downloadedBytes: downloadedBytes.value,
      })
    )
      return false;

    const readyState: PersistedDownloadState = {
      ...(savedDownloadState ?? {}),
      installPath: installPath.value,
      selectedInstallBasePath: selectedInstallBasePath.value,
      downloadSource: downloadSource.value,
      mode: "install",
      downloadedBytes: 0,
      totalBytes: 0,
      state: "ready",
      installStage: undefined,
    };
    applyPersistedDownloadState(readyState);
    updateDownloadPending.value = false;
    updateAvailable.value = false;
    pendingRepairSummary.value = null;
    remoteArchiveBytes.value = null;
    persistDownloadState("ready", "immediate");
    return true;
  } catch (error) {
    console.warn("Unable to validate restored game install", error);
    return false;
  }
}

async function refreshExternalInstallState() {
  if (launcherState.value === "ready") return true;
  const restored = await restoreReadyInstallFromFiles();
  if (!restored) return false;

  await readLocalGameVersion();
  if (!offlineMode.value) await checkGameVersion({ manual: false });
  return true;
}

async function validateCurrentPersistedState() {
  if (!savedDownloadState) return;
  const isValid = await validatePersistedDownloadState(savedDownloadState);
  if (isValid) return;
  if (savedDownloadState.state === "ready") {
    await markUnavailableInstalledGame();
    return;
  }
  await clearPersistedDownloadStateForPath(savedDownloadState.installPath || installPath.value);
  clearUpdateDownloadContext();
  downloadedBytes.value = 0;
  downloadedMb.value = 0;
  activeDownloadBytes.value = null;
  remoteArchiveBytes.value = null;
  launcherState.value = "paused";
}

function buildDownloadStatePayload(state: "paused" | "downloaded" | "ready") {
  const totalBytes = activeDownloadBytes.value ?? remoteArchiveBytes.value ?? 0;
  const payload: PersistedDownloadState = {
    installPath: installPath.value,
    selectedInstallBasePath: selectedInstallBasePath.value,
    downloadSource: downloadSource.value,
    mode:
      launcherState.value === "repairPending"
        ? "repair"
        : updateDownloadPending.value && state !== "ready"
          ? "update"
          : "install",
    downloadedBytes: Math.max(0, Math.floor(downloadedBytes.value)),
    totalBytes: Math.max(0, Math.floor(totalBytes)),
    state,
    installStage: state === "downloaded" ? installStage.value : undefined,
  };
  return payload;
}

function currentPersistableState(): "paused" | "downloaded" | "ready" {
  if (launcherState.value === "ready") return "ready";
  if (launcherState.value === "downloaded" || launcherState.value === "installing") return "downloaded";
  return "paused";
}

function writeDownloadStateToDisk(payload: PersistedDownloadState, mode: DownloadStateMode) {
  if (!payload.installPath) return;
  pendingDownloadStatePayload = payload;
  if (mode === "throttled") {
    if (downloadStateDiskWriteTimer !== undefined) return;
    downloadStateDiskWriteTimer = window.setTimeout(() => {
      downloadStateDiskWriteTimer = undefined;
      const nextPayload = pendingDownloadStatePayload;
      pendingDownloadStatePayload = null;
      if (nextPayload?.installPath) {
        void invoke("write_download_state_file", { state: nextPayload }).catch((error) => {
          console.warn("Unable to write download state file", error);
        });
      }
    }, 1000);
    return;
  }

  if (downloadStateDiskWriteTimer !== undefined) {
    window.clearTimeout(downloadStateDiskWriteTimer);
    downloadStateDiskWriteTimer = undefined;
  }
  pendingDownloadStatePayload = null;
  void invoke("write_download_state_file", { state: payload }).catch((error) => {
    console.warn("Unable to write download state file", error);
  });
}

function persistDownloadState(
  state: "paused" | "downloaded" | "ready" =
    launcherState.value === "ready" ? "ready" : launcherState.value === "downloaded" ? "downloaded" : "paused",
  mode: DownloadStateMode = "throttled",
) {
  if (typeof window === "undefined") return;
  const payload = buildDownloadStatePayload(state);
  if (state !== "ready" && payload.mode !== "update" && (payload.downloadedBytes ?? 0) <= 0 && (payload.totalBytes ?? 0) <= 0) {
    window.localStorage.removeItem(DOWNLOAD_STATE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(DOWNLOAD_STATE_STORAGE_KEY, JSON.stringify(payload));
  writeDownloadStateToDisk(payload, mode);
}

async function clearPersistedDownloadStateForPath(pathToClear: string) {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DOWNLOAD_STATE_STORAGE_KEY);
  }
  if (downloadStateDiskWriteTimer !== undefined) {
    window.clearTimeout(downloadStateDiskWriteTimer);
    downloadStateDiskWriteTimer = undefined;
  }
  pendingDownloadStatePayload = null;
  await clearDiskDownloadStateForPath(pathToClear);
}

async function clearDiskDownloadStateForPath(pathToClear: string) {
  await invoke("clear_download_state_file", { installPath: pathToClear }).catch((error) => {
    console.warn("Unable to clear download state file", error);
  });
}

function clearUpdateDownloadContext() {
  updateDownloadPending.value = false;
  updateAvailable.value = false;
}

function clearPersistedDownloadState() {
  void clearPersistedDownloadStateForPath(installPath.value);
}

function getUpdateManifestAsset(info: UpdateManifestPayload) {
  const assets = info.latest?.assets ?? [];
  return assets.find((item) => item.runtime === officialRuntime) ?? assets[0] ?? null;
}

function getRemoteArchiveBytes(info: UpdateManifestPayload) {
  const size = getUpdateManifestAsset(info)?.sizeBytes;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null;
}

async function queryArchiveContentLength(url: string) {
  if (!url) return null;

  const response = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!response.ok) return null;

  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length : null;
}

async function fetchRemoteJson<T>(url: string) {
  const text = await invoke<string>("fetch_remote_text", { url });
  return JSON.parse(text) as T;
}

async function fetchGitHubReleaseAssetJson<T>(assetId: number) {
  const url = buildGitHubReleaseAssetApiUrl(githubGameRepository, assetId);
  if (!url) throw new Error(`invalid github asset id: ${assetId}`);
  const text = await invoke<string>("fetch_github_release_asset_text", { url });
  return JSON.parse(text) as T;
}

function parseRemoteLauncherNotice(value: unknown): RemoteLauncherNotice | null {
  if (!value || typeof value !== "object") return null;
  const notice = value as Record<string, unknown>;
  if (notice.schemaVersion !== 1 || typeof notice.id !== "string" || !notice.id.trim()) return null;
  if (typeof notice.enabled !== "boolean") return null;
  if (notice.level !== "info" && notice.level !== "warning" && notice.level !== "error") return null;
  if (typeof notice.title !== "string" || typeof notice.content !== "string") return null;
  if (typeof notice.publishedAt !== "number" || !Number.isFinite(notice.publishedAt)) return null;
  if (notice.enabled && (!notice.title.trim() || !notice.content.trim())) return null;
  return {
    schemaVersion: 1,
    id: notice.id.trim(),
    enabled: notice.enabled,
    level: notice.level,
    title: notice.title.trim(),
    content: notice.content.trim(),
    publishedAt: notice.publishedAt,
  };
}

async function fetchRemoteLauncherNotice() {
  const payload = await fetchRemoteJson<unknown>(`${remoteLauncherNoticeUrl}?t=${Date.now()}`);
  const notice = parseRemoteLauncherNotice(payload);
  if (!notice) throw new Error("远程公告格式不正确");
  return notice;
}

async function refreshRemoteLauncherNotice() {
  try {
    const notice = await fetchRemoteLauncherNotice();
    remoteLauncherNotice.value = notice;
    showRemoteLauncherNotice.value = notice.enabled;
  } catch (error) {
    console.warn("Unable to load remote launcher notice", error);
    remoteLauncherNotice.value = null;
    showRemoteLauncherNotice.value = false;
  }
}

async function refreshDeveloperRemoteNotice() {
  if (!isDevToolsAvailable() || developerNoticePending.value) return;
  developerNoticePending.value = true;
  try {
    const notice = await fetchRemoteLauncherNotice();
    remoteLauncherNotice.value = notice;
    developerNoticeTitle.value = notice.title;
    developerNoticeContent.value = notice.content;
    developerNoticeLevel.value = notice.level;
  } catch (error) {
    console.warn("Unable to load developer remote notice", error);
    remoteLauncherNotice.value = null;
  } finally {
    developerNoticeLoaded.value = true;
    developerNoticePending.value = false;
  }
}

async function refreshTrafficQuota() {
  if (trafficQuotaPending.value) return;
  trafficQuotaPending.value = true;
  try {
    // The quota may change immediately after a user buys an OSS traffic package.
    // Avoid displaying a stale browser/WebView cache entry as an active download block.
    const next = await fetchRemoteJson<TrafficQuotaResponse>(`${officialUpdateApiUrl}/traffic-status?t=${Date.now()}`);
    if (!next.success) throw new Error(next.message || "traffic quota request failed");
    trafficQuota.value = next;
    if (next.available && !next.downloadAllowed && downloadSource.value === "official") {
      await pauseOfficialSourceForLowTraffic();
    }
  } catch (error) {
    console.warn("Unable to query server traffic quota", error);
    if (!trafficQuota.value) {
      trafficQuota.value = {
        success: false,
        available: false,
        downloadAllowed: true,
        isLow: false,
        totalBytes: 0,
        remainingBytes: 0,
        thresholdBytes: 0,
        updatedAt: new Date().toISOString(),
        packageCount: 0,
        message: t("traffic.unavailable"),
      };
    }
  } finally {
    trafficQuotaPending.value = false;
  }
}

function ensureOfficialTrafficAvailable() {
  if (downloadSource.value !== "official" || !officialTrafficBlocked.value) return true;
  showCheckResult(t("traffic.low"));
  return false;
}

async function resolveUpdateManifestUrl(source: UpdateManifestSource) {
  if (source.directUrl) return source.directUrl;
  if (!source.releaseAsset) return "";

  if (source.releaseProvider === "github") {
    const release = await fetchRemoteJson<GitHubReleasePayload>("https://api.github.com/repos/kirito0000001/CrossingVoid/releases/latest");
    const asset = release.assets?.find((item) => item.name === source.releaseAsset);
    if (!asset?.browser_download_url) throw new Error(`github asset not found: ${source.releaseAsset}`);

    return asset.browser_download_url;
  }

  return "";
}

async function resolveGitHubPcRelease(source: UpdateManifestSource) {
  if (!source.releaseAsset || !source.releaseTagPrefix) {
    throw new Error("github PC release selector is incomplete");
  }

  const releases = await fetchRemoteJson<GitHubReleasePayload[]>(
    `https://api.github.com/repos/${githubGameRepository}/releases?per_page=30`,
  );
  const selected = selectGitHubPlatformRelease(releases, {
    tagPrefix: source.releaseTagPrefix,
    manifestAssetName: source.releaseAsset,
  });
  if (selected?.manifestAsset.id) {
    return {
      release: selected.release as GitHubReleasePayload,
      manifestAssetId: selected.manifestAsset.id,
      manifestAssetName: source.releaseAsset,
    };
  }

  const legacyRelease = await fetchRemoteJson<GitHubReleasePayload>(
    `https://api.github.com/repos/${githubGameRepository}/releases/latest`,
  );
  const legacyAsset = legacyRelease.assets?.find((item) => item.name === source.legacyReleaseAsset);
  if (!legacyAsset?.id) {
    throw new Error(`github PC release not found: ${source.releaseTagPrefix}* / ${source.releaseAsset}`);
  }
  return {
    release: legacyRelease,
    manifestAssetId: legacyAsset.id,
    manifestAssetName: source.legacyReleaseAsset || "update.json",
  };
}

function resolveGitHubReleaseFileUrl(release: GitHubReleasePayload, fileName: string) {
  const asset = release.assets?.find((item) => item.name === fileName);
  return asset?.id ? buildGitHubReleaseAssetApiUrl(githubGameRepository, asset.id) : "";
}

async function resolveGitHubArchiveInfo(source: UpdateManifestSource): Promise<DownloadArchiveInfo> {
  const selection = await resolveGitHubPcRelease(source);
  const manifest = await fetchGitHubReleaseAssetJson<UpdateManifestPayload>(selection.manifestAssetId);
  const asset = getUpdateManifestAsset(manifest);
  if (!asset?.fileName) {
    throw new Error(`github manifest missing PC archive: ${selection.manifestAssetName}`);
  }

  const chunks = (asset.chunks ?? [])
    .filter((chunk) => Boolean(chunk?.fileName))
    .map((chunk) => {
      const url = resolveGitHubReleaseFileUrl(selection.release, chunk.fileName);
      if (!url) throw new Error(`github PC release asset not found: ${chunk.fileName}`);
      return { ...chunk, url };
    })
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const url = resolveGitHubReleaseFileUrl(selection.release, asset.fileName);
  if (!url && chunks.length === 0) {
    throw new Error(`github PC archive asset not found: ${asset.fileName}`);
  }

  return {
    version: manifest.latest?.version || "",
    fileName: asset.fileName,
    url,
    sha256: asset.sha256 || "",
    sizeBytes: getRemoteArchiveBytes(manifest) ?? 0,
    objectKey: asset.objectKey,
    chunks,
  };
}

async function fetchUpdateManifest(source: UpdateManifestSource) {
  if (source.releaseProvider === "github" && source.releaseAsset) {
    const release = await fetchRemoteJson<GitHubReleasePayload>("https://api.github.com/repos/kirito0000001/CrossingVoid/releases/latest");
    const asset = release.assets?.find((item) => item.name === source.releaseAsset);
    if (!asset?.id) throw new Error(`github asset not found: ${source.releaseAsset}`);
    return fetchGitHubReleaseAssetJson<UpdateManifestPayload>(asset.id);
  }

  const updateManifestUrl = await resolveUpdateManifestUrl(source);
  if (!updateManifestUrl) throw new Error("update manifest url is unavailable");
  return fetchRemoteJson<UpdateManifestPayload>(updateManifestUrl);
}

async function resolveReleaseAssetDownloadUrl(source: UpdateManifestSource, fileName: string) {
  if (!fileName) return "";

  if (source.releaseProvider === "github") {
    const release = await fetchRemoteJson<GitHubReleasePayload>("https://api.github.com/repos/kirito0000001/CrossingVoid/releases/latest");
    const asset = release.assets?.find((item) => item.name === fileName);
    return asset?.id ? buildGitHubReleaseAssetApiUrl(githubGameRepository, asset.id) : "";
  }

  if (source.directUrl) {
    return source.directUrl.replace(/update\.json(?:[?#].*)?$/i, fileName);
  }

  return "";
}

async function resolveBackendDownloadUrl(version: string, runtime: string, objectKey: string) {
  if (!objectKey) return "";

  const signPayload = await invoke<string>("post_remote_json", {
    url: `${officialUpdateApiUrl}/sign-download`,
    body: JSON.stringify({
      productKey: officialProductKey,
      version,
      runtime,
      objectKey,
    }),
  });
  const sign = JSON.parse(signPayload) as {
    success?: boolean;
    url?: string;
  };

  if (!sign.success || !sign.url) throw new Error(`official signed download url unavailable: ${objectKey}`);
  return sign.url;
}

async function resolveBackendChunks(version: string, runtime: string, chunks?: BackendArchiveChunk[]) {
  const items = chunks ?? [];
  const resolved: DownloadArchiveChunk[] = [];
  for (const chunk of items) {
    if (!chunk?.fileName || !chunk.objectKey) continue;
    resolved.push({
      index: chunk.index,
      count: chunk.count,
      fileName: chunk.fileName,
      url: await resolveBackendDownloadUrl(version, runtime, chunk.objectKey),
      sha256: chunk.sha256,
      sizeBytes: chunk.sizeBytes,
      objectKey: chunk.objectKey,
    });
  }

  return resolved.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function resolveReleaseChunks(source: UpdateManifestSource, chunks?: DownloadArchiveChunk[]) {
  const items = chunks ?? [];
  const resolved: DownloadArchiveChunk[] = [];
  for (const chunk of items) {
    if (!chunk?.fileName) continue;
    resolved.push({
      ...chunk,
      url: chunk.url || (await resolveReleaseAssetDownloadUrl(source, chunk.fileName)),
    });
  }

  return resolved.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function queryBackendArchiveBytes() {
  const info = await resolveBackendArchiveInfo();
  return info.sizeBytes || null;
}

async function resolveBackendArchiveInfo(): Promise<DownloadArchiveInfo> {
  const payload = await invoke<string>("post_remote_json", {
    url: `${officialUpdateApiUrl}/check`,
    body: JSON.stringify({
      productKey: officialProductKey,
      currentVersion: "0.0.0",
      channel: "stable",
      runtime: officialRuntime,
    }),
  });

  const response = JSON.parse(payload) as BackendUpdateCheckResponse;
  if (!response.success) throw new Error(response.message || "official update check returned failure");

  const manifest = response.manifest;
  const asset = manifest?.asset;
  if (!manifest?.version || !asset?.objectKey || !asset.fileName) {
    throw new Error("official update manifest missing archive asset");
  }

  const runtime = asset.runtime || officialRuntime;
  const signUrl = await resolveBackendDownloadUrl(manifest.version, runtime, asset.objectKey);
  const chunks = await resolveBackendChunks(manifest.version, runtime, asset.chunks);

  return {
    version: manifest.version,
    fileName: asset.fileName,
    url: signUrl,
    sha256: asset.sha256 || "",
    sizeBytes: asset.sizeBytes || 0,
    objectKey: asset.objectKey,
    chunks,
  };
}

async function updateRemoteArchiveInfo() {
  remoteArchivePending.value = true;
  try {
    const source = updateManifestSources[downloadSource.value];
    if ("backend" in source && source.backend) {
      remoteArchiveBytes.value = await queryBackendArchiveBytes();
      return;
    }

    const info = await resolveReleaseArchiveInfo();
    remoteArchiveBytes.value = info.sizeBytes || (await queryArchiveContentLength(info.url));
  } catch (error) {
    console.warn("Unable to query remote archive info", error);
    remoteArchiveBytes.value = null;
  } finally {
    remoteArchivePending.value = false;
  }
}

async function resolveReleaseArchiveInfo(): Promise<DownloadArchiveInfo> {
  const source = updateManifestSources[downloadSource.value];
  if ("backend" in source && source.backend) {
    return resolveBackendArchiveInfo();
  }
  if ("releaseProvider" in source && source.releaseProvider === "github") {
    return resolveGitHubArchiveInfo(source);
  }

  const manifest = await fetchUpdateManifest(source);
  const asset = getUpdateManifestAsset(manifest);
  if (!asset?.fileName) throw new Error("update manifest missing archive file name");

  const url =
    asset.downloadUrl ||
    (await resolveReleaseAssetDownloadUrl(source, asset.fileName)) ||
    ("directUrl" in source && typeof source.directUrl === "string"
      ? source.directUrl.replace(/update\.json(?:[?#].*)?$/i, asset.fileName)
      : "");
  const sizeBytes = getRemoteArchiveBytes(manifest) ?? (await queryArchiveContentLength(url)) ?? 0;
  const chunks = await resolveReleaseChunks(source, asset.chunks);
  return {
    version: manifest.latest?.version || "",
    fileName: asset.fileName,
    url,
    sha256: asset.sha256 || "",
    sizeBytes,
    objectKey: asset.objectKey,
    chunks,
  };
}

async function updateAvailableInstallSpace() {
  availableSpacePending.value = true;
  try {
    availableInstallBytes.value = await invoke<number>("get_available_space", { path: finalInstallPath.value });
  } catch (error) {
    console.warn("Unable to query available install space", error);
    availableInstallBytes.value = null;
  } finally {
    availableSpacePending.value = false;
  }
}

async function readLocalGameVersion() {
  try {
    await invoke<boolean>("migrate_mislabeled_game_version", { installPath: installPath.value });
    const payload = await invoke<string>("read_game_version_file", { installPath: installPath.value });
    const info = JSON.parse(payload) as { version?: string };
    localGameVersion.value = info.version || "";
  } catch {
    localGameVersion.value = "";
  }
  return localGameVersion.value;
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const rightParts = normalizeVersion(right).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }

  return normalizeVersion(left).localeCompare(normalizeVersion(right));
}

function isSafeSemver(value: string) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.trim());
}

function isDevToolsAvailable() {
  return import.meta.env.DEV;
}

async function refreshDeveloperLauncherVersion() {
  if (!isDevToolsAvailable()) return;
  try {
    const savedVersion = await invoke<string | null>("dev_get_launcher_version");
    if (!savedVersion || !isSafeSemver(savedVersion)) return;
    launcherVersion.value = savedVersion;
    developerVersionInput.value = savedVersion;
  } catch (error) {
    console.warn("Unable to read developer launcher version", error);
  }
}

async function chooseDeveloperPackagePath() {
  if (!isDevToolsAvailable()) return;
  const selected = await open({
    directory: true,
    multiple: false,
    title: t("dev.packageTitle"),
    defaultPath: developerPackagePath.value,
  });
  if (typeof selected === "string" && selected.trim()) {
    developerPackagePath.value = normalizeDeveloperPackagePath(selected);
  }
}

async function ensureDevScriptProgressListener() {
  if (devScriptProgressUnlisten) return;
  devScriptProgressUnlisten = await listen<DevScriptProgressEvent>("dev-script-progress", (event) => {
    if (!developerTaskActive.value) return;
    const nextPercent = Math.max(0, Math.min(100, event.payload.percent || 0));
    developerTaskMessage.value = event.payload.message || event.payload.stage || "";
    if (nextPercent + 0.01 < developerTaskPercent.value) return;
    developerTaskPercent.value = nextPercent;
  });
}

async function ensureDevScriptFinishedListener() {
  if (devScriptFinishedUnlisten) return;
  devScriptFinishedUnlisten = await listen<DevScriptFinishedEvent>("dev-script-finished", (event) => {
    if (!developerTaskActive.value) return;
    if (event.payload.script !== developerTaskKind.value) return;
    developerTaskPending.value = false;
    if (!event.payload.success && event.payload.message.includes("DEV_SCRIPT_PAUSED")) {
      developerTaskPauseRequested.value = false;
      developerTaskPaused.value = true;
      developerTaskMessage.value = "上传已暂停";
      return;
    }
    if (event.payload.success) {
      const successMessage = developerTaskKind.value === "game-windows"
        ? "PC 游戏包已发布。"
        : developerTaskKind.value === "game-android"
          ? "Android 游戏包已发布。"
          : developerTaskKind.value === "publish"
            ? "启动器新版本包已发布。"
            : "启动器打包完成。";
      finishDeveloperTask(successMessage);
    } else {
      const prefix = developerTaskKind.value === "game-windows" || developerTaskKind.value === "game-android"
        ? "游戏包发布失败"
        : developerTaskKind.value === "publish"
          ? "发布失败"
          : "启动器打包失败";
      failDeveloperTask(`${prefix}：${event.payload.message || "请打开日志目录查看原因"}`);
    }
  });
}

async function beginDeveloperTask(kind: Exclude<DeveloperTaskKind, "idle">, message: string) {
  developerTaskKind.value = kind;
  developerTaskPercent.value = 1;
  developerTaskMessage.value = message;
  developerTaskPending.value = true;
  developerTaskPaused.value = false;
  developerTaskPauseRequested.value = false;
  showSettings.value = false;
  showDevPackageConfirm.value = false;
  await ensureDevScriptProgressListener();
  await ensureDevScriptFinishedListener();
}

function finishDeveloperTask(message: string) {
  developerTaskPercent.value = 100;
  developerTaskMessage.value = message;
  developerGamePublishContext.value = null;
  developerTaskPaused.value = false;
  developerTaskPauseRequested.value = false;
  showCheckResult(message);
  window.setTimeout(() => {
    developerTaskKind.value = "idle";
    developerTaskPercent.value = 0;
    developerTaskMessage.value = "";
  }, 900);
}

function failDeveloperTask(message: string) {
  showCheckResult(message);
  developerGamePublishContext.value = null;
  developerTaskPaused.value = false;
  developerTaskPauseRequested.value = false;
  developerTaskKind.value = "idle";
  developerTaskPercent.value = 0;
  developerTaskMessage.value = "";
}

async function saveDeveloperLauncherVersion() {
  if (!isDevToolsAvailable() || developerTaskPending.value) return;
  const version = developerVersionInput.value.trim();
  if (!isSafeSemver(version)) {
    showCheckResult("版本号格式不正确，请使用 0.1.1。");
    return;
  }
  if (compareVersions(version, launcherVersion.value) <= 0) {
    showCheckResult(developerVersionHint.value);
    return;
  }

  developerTaskPending.value = true;
  try {
    const savedVersion = await invoke<string>("dev_set_launcher_version", { version });
    launcherVersion.value = savedVersion;
    developerVersionInput.value = savedVersion;
    showCheckResult(`启动器版本号已设置为 ${savedVersion}`);
  } catch (error) {
    console.warn("Unable to set launcher version", error);
    showCheckResult(`设置版本号失败：${formatUnknownError(error)}`);
  } finally {
    developerTaskPending.value = false;
  }
}

async function runDeveloperLauncherBuild() {
  if (!isDevToolsAvailable() || developerTaskPending.value) return;
  developerPackagePath.value = normalizeDeveloperPackagePath(developerPackagePath.value);
  await beginDeveloperTask("build", "准备打包启动器");
  try {
    await invoke("dev_run_launcher_script", {
      script: "build",
      outputDir: developerPackagePath.value,
    });
  } catch (error) {
    console.warn("Unable to build launcher package", error);
    failDeveloperTask(`启动器打包失败：${formatUnknownError(error)}`);
    developerTaskPending.value = false;
  }
}

async function publishDeveloperLauncherPackage() {
  if (!isDevToolsAvailable() || developerTaskPending.value) {
    showSettings.value = false;
    showCheckResult("开发工具仅在制作模式可用。");
    return;
  }
  developerPackagePath.value = normalizeDeveloperPackagePath(developerPackagePath.value);
  const selectedInstaller = await open({
    multiple: false,
    title: "选择启动器安装包 exe",
    defaultPath: developerPackagePath.value,
    filters: [{ name: "启动器安装包", extensions: ["exe"] }],
  });
  if (typeof selectedInstaller !== "string" || !selectedInstaller.trim()) {
    return;
  }

  const selectedManifest = await open({
    multiple: false,
    title: "选择启动器更新清单 latest.json 或 update.json",
    defaultPath: developerPackagePath.value,
    filters: [{ name: "启动器更新清单", extensions: ["json"] }],
  });
  if (typeof selectedManifest !== "string" || !selectedManifest.trim()) {
    return;
  }

  await beginDeveloperTask("publish", "准备发布启动器新版本包");
  try {
    await invoke("dev_run_launcher_script", {
      script: "publish",
      outputDir: developerPackagePath.value,
      installerPath: selectedInstaller,
      manifestPath: selectedManifest,
    });
  } catch (error) {
    console.warn("Unable to publish launcher package", error);
    failDeveloperTask(`发布失败：${formatUnknownError(error)}`);
    developerTaskPending.value = false;
  }
}

function isSafeGameReleaseVersion(version: string) {
  return /^V?\d+\.\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?$/i.test(version.trim());
}

async function publishDeveloperGamePackage(
  platform: "Windows" | "Android",
  channel: "Stable" | "Test",
) {
  if (!isDevToolsAvailable() || developerTaskPending.value) return;

  const releaseVersion = developerGameVersion.value.trim();
  const releaseTitle = developerGameTitle.value.trim();
  if (!isSafeGameReleaseVersion(releaseVersion)) {
    showCheckResult("游戏版本号格式不正确，请使用 V0.5.12 或 0.5.12.1-Beta。");
    return;
  }
  if (!releaseTitle || releaseTitle.length > 100 || /[\r\n]/.test(releaseTitle)) {
    showCheckResult("游戏发布标题不能为空、不能换行，且不能超过 100 个字符。");
    return;
  }

  const pathStorageKey = platform === "Windows"
    ? DEV_GAME_WINDOWS_PATH_STORAGE_KEY
    : DEV_GAME_ANDROID_PATH_STORAGE_KEY;
  const defaultPath = window.localStorage.getItem(pathStorageKey)
    || (platform === "Windows" ? "D:\\TFAC-hz64\\CrossingVoid" : "D:\\TFAC-hz64");
  const selected = await open({
    directory: true,
    multiple: false,
    title: platform === "Windows" ? "选择 PC 游戏打包目录" : "选择包含 APK 和 OBB 的 Android 打包目录",
    defaultPath,
  });
  if (typeof selected !== "string" || !selected.trim()) return;

  window.localStorage.setItem(pathStorageKey, selected);
  const context: DeveloperGamePublishContext = {
    platform,
    channel,
    gameDirectory: selected,
    releaseVersion,
    releaseTitle,
  };
  developerGamePublishContext.value = context;
  await runDeveloperGamePublish(context, false);
}

async function runDeveloperGamePublish(context: DeveloperGamePublishContext, resume: boolean) {
  const taskKind = context.platform === "Windows" ? "game-windows" : "game-android";
  if (resume) {
    developerTaskKind.value = taskKind;
    developerTaskPending.value = true;
    developerTaskPaused.value = false;
    developerTaskPauseRequested.value = false;
    developerTaskMessage.value = "正在继续上传";
    await ensureDevScriptProgressListener();
    await ensureDevScriptFinishedListener();
  } else {
    await beginDeveloperTask(
      taskKind,
      `${context.channel === "Test" ? "测试服 · " : ""}${context.platform === "Windows" ? "准备扫描 PC 游戏包" : "准备扫描 Android 游戏包"}`,
    );
  }

  try {
    await invoke("dev_run_launcher_script", {
      script: taskKind,
      gamePlatform: context.platform,
      gameChannel: context.channel,
      gameDirectory: context.gameDirectory,
      releaseVersion: context.releaseVersion,
      releaseTitle: context.releaseTitle,
    });
  } catch (error) {
    console.error("Unable to publish game package", error);
    failDeveloperTask(`游戏包发布失败：${formatUnknownError(error)}`);
    developerTaskPending.value = false;
  }
}

async function pauseDeveloperUpload() {
  if (!canPauseDeveloperUpload.value) return;
  developerTaskPauseRequested.value = true;
  developerTaskMessage.value = "正在暂停上传";
  try {
    await invoke("dev_pause_script");
  } catch (error) {
    developerTaskPauseRequested.value = false;
    developerTaskMessage.value = developerTaskStatus(developerTaskKind.value);
    console.warn("Unable to pause developer upload", error);
    showCheckResult(`暂停上传失败：${formatUnknownError(error)}`);
  }
}

async function resumeDeveloperUpload() {
  if (!canResumeDeveloperUpload.value || !developerGamePublishContext.value) return;
  await runDeveloperGamePublish(developerGamePublishContext.value, true);
}

async function publishDeveloperRemoteNotice(enabled: boolean) {
  if (!isDevToolsAvailable() || developerNoticePending.value) return;
  if (enabled && !developerNoticeTitle.value.trim()) {
    showCheckResult("请填写公告标题。");
    return;
  }
  if (enabled && !developerNoticeContent.value.trim()) {
    showCheckResult("请填写公告正文。");
    return;
  }

  developerNoticePending.value = true;
  try {
    const result = await invoke<string>("dev_publish_remote_notice", {
      title: developerNoticeTitle.value,
      content: developerNoticeContent.value,
      level: developerNoticeLevel.value,
      enabled,
    });
    const notice = await fetchRemoteLauncherNotice();
    remoteLauncherNotice.value = notice;
    developerNoticeTitle.value = notice.title;
    developerNoticeContent.value = notice.content;
    developerNoticeLevel.value = notice.level;
    developerNoticeLoaded.value = true;
    showCheckResult(result);
  } catch (error) {
    console.error("Unable to publish remote launcher notice", error);
    showCheckResult(`远程公告操作失败：${formatUnknownError(error)}`);
  } finally {
    developerNoticePending.value = false;
  }
}

async function openDeveloperProjectFolder() {
  if (!isDevToolsAvailable()) return;
  try {
    await invoke("dev_open_project_folder");
  } catch (error) {
    console.warn("Unable to open project folder", error);
    showCheckResult(`打开项目文件夹失败：${formatUnknownError(error)}`);
  }
}

async function openLauncherLogFolder() {
  try {
    await invoke("open_launcher_log_folder");
  } catch (error) {
    console.warn("Unable to open launcher log folder", error);
    showCheckResult(`打开日志目录失败：${formatUnknownError(error)}`);
  }
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function showCheckResult(message: string) {
  lastCheckMessage.value = message;
  if (lastCheckMessageTimer !== undefined) {
    window.clearTimeout(lastCheckMessageTimer);
  }
  lastCheckMessageTimer = window.setTimeout(() => {
    lastCheckMessage.value = "";
    lastCheckMessageTimer = undefined;
  }, 3000);
}

async function refreshGameRunningState() {
  try {
    const running = await invoke<boolean>("is_game_running");
    gameRunning.value = running;
    return running;
  } catch (error) {
    console.warn("Unable to check game process", error);
    return gameRunning.value;
  }
}

function startGameRunningPolling() {
  if (gameRunningPollTimer !== undefined) return;
  gameRunningPollTimer = window.setInterval(async () => {
    const running = await refreshGameRunningState();
    if (!running && !gameLaunchPending.value) {
      stopGameRunningPolling();
    }
  }, 5000);
}

function stopGameRunningPolling() {
  if (gameRunningPollTimer === undefined) return;
  window.clearInterval(gameRunningPollTimer);
  gameRunningPollTimer = undefined;
}

function syncGameRunningPolling() {
  if (gameRunning.value || gameLaunchPending.value) {
    startGameRunningPolling();
    return;
  }

  stopGameRunningPolling();
}

async function ensureFreshVersionBeforeLaunch() {
  if (offlineMode.value || updateAvailable.value || launcherState.value !== "ready") return;
  const staleMs = 10 * 60 * 1000;
  if (Date.now() - lastVersionCheckAt.value < staleMs) return;
  await checkGameVersion({ manual: false });
}

function formatLaunchFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.includes("GAME_EXITED_EARLY")) {
    const code = raw.split("GAME_EXITED_EARLY:")[1]?.trim() || "unknown";
    return `游戏启动后异常退出，退出码 ${code}。可以先验证完整性，或检查运行库和显卡驱动。`;
  }
  if (raw.includes("Game executable not found")) return "启动失败：未找到 CrossingVoid.exe，请重新定位游戏或验证完整性。";
  if (raw.includes("Access is denied") || raw.includes("拒绝访问")) return "启动失败：权限不足，请尝试以管理员身份运行启动器。";
  if (raw.includes("VC++") || raw.includes("redistributable")) return "启动失败：运行库异常，请重新安装 VC++ 运行库后再试。";
  return "启动失败：请验证游戏完整性，或打开日志查看原因。";
}

async function markInstalledGameRepairRequired(message: string) {
  pendingRepairSummary.value = { checkedFiles: 1, invalidFiles: 1, missingFiles: 1 };
  repairProgressPercent.value = 100;
  repairProgressItems.value = { checked: 0, total: 1, repaired: 0 };
  updateDownloadPending.value = false;
  updateAvailable.value = false;
  localGameVersion.value = "";
  downloadedBytes.value = 0;
  downloadedMb.value = 0;
  activeDownloadBytes.value = null;
  installStage.value = "downloaded";
  launcherState.value = "repairPending";
  persistDownloadState("paused", "immediate");
  showCheckResult(message);
}

async function hasRepairableGameManifest() {
  try {
    return await invoke<boolean>("validate_game_install_state", {
      installPath: installPath.value,
      state: "repairable",
    });
  } catch (error) {
    console.warn("Unable to check repairable game manifest", error);
    return false;
  }
}

async function markFullGameDownloadRequired(message: string) {
  await clearPersistedDownloadStateForPath(installPath.value);
  pendingRepairSummary.value = null;
  repairProgressPercent.value = 0;
  repairProgressItems.value = null;
  clearUpdateDownloadContext();
  localGameVersion.value = "";
  downloadedBytes.value = 0;
  downloadedMb.value = 0;
  activeDownloadBytes.value = null;
  installStage.value = "downloaded";
  launcherState.value = "paused";
  showCheckResult(message);
}

async function markUnavailableInstalledGame() {
  if (await hasRepairableGameManifest()) {
    await markInstalledGameRepairRequired("检测到部分游戏文件缺失，请使用修复文件补齐。");
    return;
  }
  await markFullGameDownloadRequired("未找到游戏文件，已切换为下载游戏。");
}

async function checkGameVersion(options: { manual?: boolean } = {}) {
  if (offlineMode.value || launcherState.value !== "ready" || versionCheckPending.value) return;

  versionCheckPending.value = true;
  updateAvailable.value = false;
  try {
    const [localVersion, archive] = await Promise.all([readLocalGameVersion(), resolveReleaseArchiveInfo()]);
    remoteGameVersion.value = archive.version || "";
    remoteArchiveBytes.value = archive.sizeBytes || remoteArchiveBytes.value;
    updateAvailable.value =
      Boolean(localVersion && remoteGameVersion.value) && compareVersions(remoteGameVersion.value, localVersion) > 0;
    const result = updateAvailable.value ? "发现新版本" : "版本已是最新";
    const message = `版本检测完成：本地 ${localVersion || "未知"} / 远程 ${remoteGameVersion.value || "未知"}，${result}`;
    console.info(message);
    showCheckResult(message);
    lastVersionCheckAt.value = Date.now();
  } catch (error) {
    console.warn(options.manual ? "Unable to check game updates manually" : "Unable to check game updates on startup", error);
    updateAvailable.value = false;
    if (options.manual) {
      const message = downloadSource.value === "github"
        ? "Github 源检查失败：无法读取版本清单，请确认网络代理可用后重试。"
        : "版本检测失败：无法获取版本信息，请稍后重试。";
      showCheckResult(message);
    }
  } finally {
    versionCheckPending.value = false;
  }
}

async function openLocalGameFiles() {
  showMenu.value = false;
  try {
    await invoke("open_game_folder", { installPath: installPath.value });
  } catch (error) {
    console.warn("Unable to open game folder", error);
  }
}

async function launchInstalledGame() {
  showMenu.value = false;
  if (gameLaunchPending.value || gameRunning.value) return;
  gameLaunchPending.value = true;
  try {
    await refreshGameRunningState();
    if (gameRunning.value) {
      showCheckResult("游戏已经在运行中。");
      return;
    }
    if (!(await ensureInstalledGameExistsBeforeLaunch())) return;
    await ensureFreshVersionBeforeLaunch();
    if (updateAvailable.value && !offlineMode.value && !offlinePlayable.value) return;
    if (!(await ensureAutomaticRepairBeforeLaunch())) return;
    const result = await invoke<LaunchGameResult>("launch_game", {
      installPath: installPath.value,
      useDx11: useDx11.value,
      exitLauncher: hideAfterGameLaunch.value,
    });
    gameRunning.value = true;
    if (result.alreadyRunning) {
      showCheckResult("游戏已经在运行中。");
    }
    if (hideAfterGameLaunch.value) return;
    await hideLauncherWindow();
  } catch (error) {
    console.warn("Unable to launch game", error);
    const launchFailure = formatLaunchFailure(error);
    if (launchFailure.includes("未找到 CrossingVoid.exe")) {
      await markUnavailableInstalledGame();
    } else {
      showCheckResult(launchFailure);
    }
    await showLauncherWindow();
  } finally {
    gameLaunchPending.value = false;
  }
}

async function ensureInstalledGameExistsBeforeLaunch() {
  try {
    const installReady = await invoke<boolean>("validate_game_install_state", {
      installPath: installPath.value,
      state: "ready",
    });
    if (installReady) return true;
  } catch (error) {
    console.warn("Unable to validate game before launch", error);
  }

  await markUnavailableInstalledGame();
  return false;
}

function toggleOfflineMode() {
  offlineMode.value = !offlineMode.value;
  if (typeof window !== "undefined") {
    if (offlineMode.value) window.localStorage.setItem(OFFLINE_MODE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(OFFLINE_MODE_STORAGE_KEY);
  }
  if (offlineMode.value) {
    if (launcherState.value === "downloading") {
      void pauseGameDownload();
    }
    updateAvailable.value = false;
    versionCheckPending.value = false;
  } else {
    void checkGameVersion({ manual: true });
  }
}

async function ensureInstallProgressListener() {
  if (installProgressUnlisten) return;

  installProgressUnlisten = await listen<InstallProgressEvent>("game-install-progress", (event) => {
    const payload = event.payload;
    if (launcherState.value === "installing") {
      if (payload.stage === "merging") installProgressStage.value = "merging";
      if (payload.stage === "verifying") installProgressStage.value = "verifying";
      if (payload.stage === "extracting") {
        installProgressStage.value = "extracting";
        installStage.value = "extracting";
      }
      installProgressPercent.value = Math.max(0, Math.min(100, payload.percent || 0));
      installProgressItems.value =
        typeof payload.currentItems === "number" && typeof payload.totalItems === "number"
          ? { current: payload.currentItems, total: payload.totalItems }
          : null;
    }
    if (payload.stage === "completed") {
      installProgressPercent.value = 100;
      installProgressStage.value = "finishing";
      installProgressItems.value = null;
      installStage.value = "downloaded";
      persistDownloadState("ready", "immediate");
    } else if (launcherState.value === "installing") {
      persistDownloadState("downloaded");
    }
  });
}

async function ensureDownloadProgressListener() {
  if (downloadProgressUnlisten) return;

  downloadProgressUnlisten = await listen<DownloadProgressEvent>("game-download-progress", (event) => {
    if (launcherState.value !== "downloading" && launcherState.value !== "repairing") return;
    const payload = event.payload;
    const totalBytes = payload.totalBytes || activeDownloadBytes.value || remoteArchiveBytes.value || fallbackRequiredInstallBytes;
    const nextDownloadedBytes = Math.max(0, payload.downloadedBytes || 0);
    activeDownloadBytes.value = totalBytes;
    remoteArchiveBytes.value = totalBytes;
    downloadedBytes.value = nextDownloadedBytes;
    downloadedMb.value = bytesToMb(nextDownloadedBytes);
    if (launcherState.value === "downloading") {
      downloadEstimate.value = downloadTimeEstimator.record(nextDownloadedBytes, totalBytes, performance.now());
      persistDownloadState(nextDownloadedBytes >= totalBytes ? "downloaded" : "paused");
    } else if (repairOperationStage.value === "downloading") {
      repairProgressPercent.value = Math.max(0, Math.min(100, payload.percent || 0));
    }
  });
}

async function ensureAutomaticRepairBeforeLaunch() {
  if (!autoRepair.value || launcherState.value !== "ready") return launcherState.value === "ready";

  launcherState.value = "checking";
  resetVerificationProgressDetail();
  repairProgressPercent.value = 0;
  repairProgressItems.value = null;
  let summary: ManifestVerifySummary;
  try {
    summary = await invoke<ManifestVerifySummary>("check_game_manifest_files", {
      installPath: installPath.value,
    });
  } catch (error) {
    console.error("Automatic game file check failed", error);
    summary = { checkedFiles: 1, invalidFiles: 1, missingFiles: 1 };
  }

  if (summary.invalidFiles <= 0) {
    launcherState.value = "ready";
    return true;
  }

  pendingRepairSummary.value = summary;
  repairProgressPercent.value = 100;
  repairProgressItems.value = {
    checked: Math.max(0, summary.checkedFiles - summary.invalidFiles),
    total: Math.max(0, summary.checkedFiles),
    repaired: 0,
  };
  launcherState.value = "repairPending";
  persistDownloadState("paused", "immediate");
  await repairMissingGameFiles();
  return currentPersistableState() === "ready";
}

async function ensureRepairProgressListener() {
  if (repairProgressUnlisten) return;

  repairProgressUnlisten = await listen<RepairProgressEvent>("game-repair-progress", (event) => {
    if (launcherState.value !== "checking" && launcherState.value !== "repairing") return;
    const payload = event.payload;
    repairProgressPercent.value = Math.max(0, Math.min(100, payload.percent || 0));
    repairProgressItems.value = {
      checked: Math.max(0, payload.checkedFiles || 0),
      total: Math.max(0, payload.totalFiles || 0),
      repaired: Math.max(0, payload.repairedFiles || 0),
    };
    verificationCurrentFile.value = payload.currentFile || "";
    verificationProcessedBytes.value = Math.max(0, payload.processedBytes || 0);
    verificationTotalBytes.value = Math.max(0, payload.totalBytes || 0);
    verificationCurrentFileBytes.value = Math.max(0, payload.currentFileBytes || 0);
    verificationCurrentFileTotalBytes.value = Math.max(0, payload.currentFileTotalBytes || 0);
  });
}

function resetVerificationProgressDetail() {
  verificationCurrentFile.value = "";
  verificationProcessedBytes.value = 0;
  verificationTotalBytes.value = 0;
  verificationCurrentFileBytes.value = 0;
  verificationCurrentFileTotalBytes.value = 0;
}

async function downloadGameArchive() {
  if (!ensureOfficialTrafficAvailable()) return;
  downloadTimeEstimator.reset();
  downloadEstimate.value = { status: "calculating" };
  launcherState.value = "downloading";
  downloadPauseRequested.value = false;
  try {
    await ensureDownloadProgressListener();
    const archive = await resolveReleaseArchiveInfo();
    activeDownloadBytes.value = archive.sizeBytes || remoteArchiveBytes.value || fallbackRequiredInstallBytes;
    remoteArchiveBytes.value = activeDownloadBytes.value;
    if (downloadedBytes.value <= 0) {
      downloadedBytes.value = 0;
      downloadedMb.value = 0;
    }
    downloadEstimate.value = downloadTimeEstimator.record(
      downloadedBytes.value,
      activeDownloadBytes.value,
      performance.now(),
    );
    persistDownloadState("paused", "immediate");
    await invoke("download_game_archive", {
      url: archive.url,
      installPath: installPath.value,
      expectedSize: archive.sizeBytes,
      fileName: archive.fileName,
      chunks: archive.chunks ?? [],
      speedLimitBytesPerSecond: getDownloadSpeedLimitBytes(),
    });
    downloadedBytes.value = activeDownloadBytes.value ?? archive.sizeBytes;
    downloadedMb.value = bytesToMb(downloadedBytes.value);
    installStage.value = "downloaded";
    launcherState.value = "downloaded";
    updateAvailable.value = false;
    persistDownloadState("downloaded", "immediate");
  } catch (error) {
    if (!downloadPauseRequested.value && String(error) !== "DOWNLOAD_CANCELLED") {
      console.error("Game download failed", error);
    }
    launcherState.value = "paused";
    persistDownloadState("paused", "immediate");
  } finally {
    downloadPauseRequested.value = false;
  }
}

async function installDownloadedGameArchive() {
  gameOperationCancelRequested.value = false;
  try {
    const archive = await resolveReleaseArchiveInfo();
    activeDownloadBytes.value = archive.sizeBytes || remoteArchiveBytes.value || fallbackRequiredInstallBytes;
    remoteArchiveBytes.value = activeDownloadBytes.value;
    const archiveReady = await invoke<boolean>("validate_downloaded_archive_state", {
      installPath: installPath.value,
      expectedSize: archive.sizeBytes,
      fileName: archive.fileName,
      chunks: archive.chunks ?? [],
      installStage: installStage.value,
    });
    if (!archiveReady) {
      launcherState.value = "paused";
      installStage.value = "downloaded";
      installProgressPercent.value = 0;
      installProgressItems.value = null;
      persistDownloadState("paused", "immediate");
      return;
    }

    launcherState.value = "installing";
    installProgressPercent.value = 0;
    installProgressStage.value = installStage.value === "merged" || installStage.value === "extracting" ? "verifying" : "merging";
    installProgressItems.value = null;
    downloadPauseRequested.value = false;
    await ensureInstallProgressListener();
    downloadedBytes.value = activeDownloadBytes.value;
    downloadedMb.value = bytesToMb(activeDownloadBytes.value);
    if (installStage.value === "extracting") installStage.value = "merged";
    persistDownloadState("downloaded", "immediate");
    await invoke("install_downloaded_game_archive", {
      installPath: installPath.value,
      sha256: archive.sha256,
      expectedSize: archive.sizeBytes,
      fileName: archive.fileName,
      createDesktopShortcut: createDesktopShortcut.value,
      chunks: archive.chunks ?? [],
      installStage: installStage.value,
    });
    downloadedBytes.value = activeDownloadBytes.value;
    downloadedMb.value = bytesToMb(activeDownloadBytes.value);
    const installReady = await invoke<boolean>("validate_game_install_state", {
      installPath: installPath.value,
      state: "ready",
    });
    if (!installReady) {
      throw new Error("Game install finished but ready marker was not found.");
    }
    launcherState.value = "ready";
    clearUpdateDownloadContext();
    persistDownloadState("ready", "immediate");
  } catch (error) {
    const cancelled = isGameOperationCancelled(error);
    if (!cancelled && !downloadPauseRequested.value) {
      console.error("Game install failed", error);
    }
    launcherState.value = "downloaded";
    installProgressPercent.value = 0;
    installProgressItems.value = null;
    persistDownloadState("downloaded", "immediate");
    if (cancelled) showCheckResult("已取消安装，下载文件已保留。");
  } finally {
    downloadPauseRequested.value = false;
    gameOperationCancelRequested.value = false;
  }
}

async function pauseGameDownload() {
  if (launcherState.value !== "downloading") return;
  downloadPauseRequested.value = true;
  launcherState.value = "paused";
  persistDownloadState("paused", "immediate");
  try {
    await invoke("pause_game_download");
  } catch (error) {
    console.warn("Unable to pause game download", error);
  }
}

function isGameOperationCancelled(error: unknown) {
  return gameOperationCancelRequested.value || repairDownloadPauseRequested.value || String(error).includes("DOWNLOAD_CANCELLED");
}

function throwIfGameOperationCancelled() {
  if (gameOperationCancelRequested.value || repairDownloadPauseRequested.value) {
    throw new Error("DOWNLOAD_CANCELLED");
  }
}

async function pauseRepairDownload() {
  if (!canPauseRepairDownload.value) return;
  repairDownloadPauseRequested.value = true;
  try {
    await invoke("cancel_game_operation");
  } catch (error) {
    repairDownloadPauseRequested.value = false;
    console.warn("Unable to pause repair download", error);
    showCheckResult(`暂停修复下载失败：${formatUnknownError(error)}`);
  }
}

async function cancelCurrentGameOperation() {
  if (!canCancelCurrentGameOperation.value) return;
  gameOperationCancelRequested.value = true;
  try {
    await invoke("cancel_game_operation");
  } catch (error) {
    gameOperationCancelRequested.value = false;
    console.warn("Unable to cancel game operation", error);
    showCheckResult(`取消操作失败：${formatUnknownError(error)}`);
  }
}

async function pauseOfficialSourceForLowTraffic() {
  if (downloadSource.value !== "official") return;
  if (launcherState.value === "downloading") {
    await pauseGameDownload();
    showCheckResult(t("traffic.sourcePaused"));
    return;
  }

  if (canPauseRepairDownload.value) {
    await pauseRepairDownload();
    showCheckResult(t("traffic.sourcePaused"));
  }
}

async function confirmInstallPathAndDownload() {
  if (!ensureOfficialTrafficAvailable()) {
    showInstallConfirm.value = false;
    showSettings.value = true;
    activeSettingsTab.value = "download";
    return;
  }
  installPath.value = finalInstallPath.value;
  showInstallConfirm.value = false;
  updateDownloadPending.value = false;
  await downloadGameArchive();
}

async function chooseInstallPath() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: installPath.value,
      title: t("dialog.chooseInstallPath"),
    });

    if (typeof selected !== "string") return false;

    selectedInstallBasePath.value = selected;
    installPath.value = buildFinalInstallPath(selected);
    persistDownloadState(currentPersistableState(), "immediate");
    return true;
  } catch (error) {
    console.warn("Unable to choose install path", error);
    return false;
  }
}

async function relocateInstalledGame() {
  if (launcherState.value === "checking" || launcherState.value === "installing" || launcherState.value === "repairing") return false;

  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: installPath.value,
      title: t("dialog.chooseGamePath"),
    });

    if (typeof selected !== "string") return false;

    const nextPath = selected.replace(/[\\/]$/, "");
    const isReady = await invoke<boolean>("validate_game_install_state", {
      installPath: nextPath,
      state: "ready",
    });

    if (!isReady) {
      showCheckResult("重新定位失败：未找到 CrossingVoid.version.json");
      return false;
    }

    const previousPath = installPath.value;
    installPath.value = nextPath;
    selectedInstallBasePath.value = inferInstallBasePathFromGamePath(nextPath);
    downloadedBytes.value = 0;
    downloadedMb.value = 0;
    activeDownloadBytes.value = null;
    installStage.value = "downloaded";
    pendingRepairSummary.value = null;
    repairProgressPercent.value = 0;
    repairProgressItems.value = null;
    clearUpdateDownloadContext();
    launcherState.value = "ready";
    await clearPersistedDownloadStateForPath(previousPath);
    persistDownloadState("ready", "immediate");
    await readLocalGameVersion();
    showCheckResult(`重新定位完成：${nextPath}`);
    if (!offlineMode.value) {
      void checkGameVersion({ manual: true });
    }
    return true;
  } catch (error) {
    console.warn("Unable to relocate installed game", error);
    showCheckResult("重新定位失败：无法读取该目录");
    return false;
  }
}

async function handlePrimaryAction() {
  if (canPauseDeveloperUpload.value) {
    await pauseDeveloperUpload();
    return;
  }
  if (canResumeDeveloperUpload.value) {
    await resumeDeveloperUpload();
    return;
  }
  if (canPauseRepairDownload.value) {
    await pauseRepairDownload();
    return;
  }
  if (canCancelCurrentGameOperation.value) {
    await cancelCurrentGameOperation();
    return;
  }
  if (launcherUpdateConfirmStage.value === "available") {
    await installPendingLauncherUpdate();
    return;
  }
  if (launcherState.value === "checking" || launcherState.value === "installing" || launcherState.value === "repairing") return;
  await refreshExternalInstallState();
  if (offlinePlayable.value) {
    await launchInstalledGame();
    return;
  }
  if (launcherState.value === "repairPending") {
    await repairMissingGameFiles();
    return;
  }
  if (launcherState.value === "ready") {
    if (updateAvailable.value && !offlineMode.value) {
      updateDownloadPending.value = true;
      downloadedBytes.value = 0;
      downloadedMb.value = 0;
      activeDownloadBytes.value = null;
      installStage.value = "downloaded";
      await downloadGameArchive();
      return;
    }
    await launchInstalledGame();
    return;
  }
  if (launcherState.value === "downloading") {
    await pauseGameDownload();
    return;
  }

  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) {
    await installDownloadedGameArchive();
    return;
  }

  if (updateDownloadPending.value) {
    await downloadGameArchive();
    return;
  }

  if (downloadedMb.value <= 0) {
    showInstallConfirm.value = true;
    void updateAvailableInstallSpace();
    return;
  }

  await downloadGameArchive();
}

function checkForUpdates() {
  if (!canCheckGameUpdates.value) return;
  void checkUpdatesInOrder({ manual: true });
}

async function checkUpdatesInOrder(options: { manual?: boolean } = {}) {
  const hasLauncherUpdate = await checkLauncherUpdate(options);
  if (!hasLauncherUpdate) {
    await checkGameVersion(options);
  }
}

async function checkLauncherUpdate(options: { manual?: boolean } = {}): Promise<boolean> {
  if (import.meta.env.DEV) {
    if (options.manual) {
      showCheckResult("开发版不参与启动器更新检查。");
    }
    return false;
  }
  if (offlineMode.value) return false;
  if (launcherUpdatePending.value || launcherUpdateActive.value) {
    return launcherUpdateConfirmStage.value === "available" || launcherUpdateActive.value;
  }
  launcherUpdatePending.value = true;
  launcherUpdateStage.value = "checking";
  launcherUpdateConfirmStage.value = "idle";
  pendingLauncherUpdate.value = null;
  launcherUpdateVersion.value = "";
  launcherUpdateDownloadedBytes.value = 0;
  launcherUpdateTotalBytes.value = 0;
  try {
    const update = await check();
    if (!update) {
      launcherUpdateStage.value = "idle";
      if (options.manual) {
        showSettings.value = false;
        showCheckResult("启动器已是最新版本。");
      }
      return false;
    }

    showSettings.value = false;
    launcherUpdateVersion.value = update.version;
    pendingLauncherUpdate.value = update;
    launcherUpdateConfirmStage.value = "available";
    launcherUpdateStage.value = "idle";
    showCheckResult(`${t("settings.launcherUpdateReady")} ${update.version}`);
    return true;
  } catch (error) {
    console.error("Launcher update check failed", error);
    launcherUpdateStage.value = "failed";
    if (options.manual) {
      showCheckResult("启动器更新检查失败，请稍后重试。");
      window.setTimeout(() => {
        if (launcherUpdateStage.value === "failed") {
          resetLauncherUpdateProgress();
        }
      }, 3000);
    } else {
      resetLauncherUpdateProgress();
    }
    return false;
  } finally {
    launcherUpdatePending.value = false;
  }
}

async function installPendingLauncherUpdate() {
  if (launcherUpdatePending.value || launcherUpdateActive.value) return;
  const update = pendingLauncherUpdate.value;
  if (!update) {
    launcherUpdateConfirmStage.value = "idle";
    showCheckResult("启动器更新信息已失效，请重新检查版本。");
    return;
  }

  launcherUpdatePending.value = true;
  launcherUpdateConfirmStage.value = "idle";
  launcherUpdateStage.value = "downloading";
  launcherUpdateDownloadedBytes.value = 0;
  launcherUpdateTotalBytes.value = 0;
  try {
    await update.download(handleLauncherUpdateDownloadEvent);
    launcherUpdateStage.value = "installing";
    await update.install();
    launcherUpdateStage.value = "restarting";
    pendingLauncherUpdate.value = null;
    await relaunch();
  } catch (error) {
    const failedStage = launcherUpdateStage.value;
    console.error(`Launcher update failed during ${failedStage}`, error);
    launcherUpdateStage.value = "failed";
    showCheckResult(
      failedStage === "installing"
        ? "启动器更新安装失败，请关闭启动器后重试。"
        : "启动器更新下载失败，请稍后重试。",
    );
    window.setTimeout(() => {
      if (launcherUpdateStage.value === "failed") {
        resetLauncherUpdateProgress();
      }
    }, 3000);
  } finally {
    launcherUpdatePending.value = false;
  }
}

function handleLauncherUpdateDownloadEvent(event: DownloadEvent) {
  if (event.event === "Started") {
    launcherUpdateStage.value = "downloading";
    launcherUpdateDownloadedBytes.value = 0;
    launcherUpdateTotalBytes.value = Math.max(0, event.data.contentLength || 0);
    return;
  }

  if (event.event === "Progress") {
    launcherUpdateStage.value = "downloading";
    launcherUpdateDownloadedBytes.value += Math.max(0, event.data.chunkLength || 0);
    return;
  }

  if (event.event === "Finished") {
    launcherUpdateStage.value = "downloading";
  }
  if (launcherUpdateTotalBytes.value > 0) {
    launcherUpdateDownloadedBytes.value = launcherUpdateTotalBytes.value;
  }
}

function resetLauncherUpdateProgress() {
  launcherUpdateStage.value = "idle";
  launcherUpdateConfirmStage.value = "idle";
  pendingLauncherUpdate.value = null;
  launcherUpdateVersion.value = "";
  launcherUpdateDownloadedBytes.value = 0;
  launcherUpdateTotalBytes.value = 0;
}

async function verifyGameIntegrity() {
  if (!canVerifyGameIntegrity.value || versionCheckPending.value) return;

  showMenu.value = false;
  if (!(await hasRepairableGameManifest())) {
    await markFullGameDownloadRequired("未找到游戏文件，已切换为下载游戏。");
    return;
  }

  const previousState = launcherState.value;
  const previousRepairSummary = pendingRepairSummary.value;
  pendingRepairSummary.value = null;
  if (!offlineMode.value) {
    await checkGameVersion({ manual: true });
    if (updateAvailable.value) return;
  }

  launcherState.value = "checking";
  repairOperationStage.value = "verifying";
  gameOperationCancelRequested.value = false;
  resetVerificationProgressDetail();
  repairProgressPercent.value = 0;
  repairProgressItems.value = null;
  try {
    await ensureRepairProgressListener();
    const manifestSummary = await invoke<ManifestVerifySummary>("verify_game_manifest", {
      installPath: installPath.value,
    });
    if (manifestSummary.invalidFiles <= 0) {
      const installReady = await invoke<boolean>("validate_game_install_state", {
        installPath: installPath.value,
        state: "ready",
      });
      if (!installReady) {
        await markInstalledGameRepairRequired("检测到部分游戏文件缺失，请使用修复文件补齐。");
        return;
      }
      await invoke("install_vc_redist", { installPath: installPath.value });
      const message = `完整性验证完成：${manifestSummary.checkedFiles}/${manifestSummary.checkedFiles}，异常 0`;
      console.info(message);
      showCheckResult(message);
      launcherState.value = "ready";
      persistDownloadState("ready", "immediate");
      return;
    }

    pendingRepairSummary.value = manifestSummary;
    repairProgressPercent.value = 100;
    repairProgressItems.value = {
      checked: Math.max(0, manifestSummary.checkedFiles - manifestSummary.missingFiles),
      total: Math.max(0, manifestSummary.checkedFiles),
      repaired: 0,
    };
    launcherState.value = "repairPending";
    persistDownloadState("paused", "immediate");
    return;
  } catch (error) {
    if (isGameOperationCancelled(error)) {
      pendingRepairSummary.value = previousRepairSummary;
      launcherState.value = previousState;
      persistDownloadState(previousState === "ready" ? "ready" : "paused", "immediate");
      showCheckResult("已取消完整性验证。");
      return;
    }
    console.error("Unable to verify game integrity", error);
    const installReady = await invoke<boolean>("validate_game_install_state", {
      installPath: installPath.value,
      state: "ready",
    }).catch(() => false);
    if (!installReady) {
      await markFullGameDownloadRequired("无法读取游戏清单，已切换为重新下载游戏。");
    } else {
      launcherState.value = "ready";
      persistDownloadState("ready", "immediate");
      showCheckResult(`完整性验证失败：${formatUnknownError(error)}`);
    }
  } finally {
    repairOperationStage.value = "idle";
    gameOperationCancelRequested.value = false;
    if (launcherState.value !== "repairPending") {
      repairProgressPercent.value = 0;
      repairProgressItems.value = null;
    }
  }
}

async function repairMissingGameFiles() {
  if (launcherState.value !== "repairPending") return;
  if (!ensureOfficialTrafficAvailable()) {
    showSettings.value = true;
    activeSettingsTab.value = "download";
    return;
  }

  launcherState.value = "repairing";
  repairOperationStage.value = "preparing";
  repairDownloadPauseRequested.value = false;
  gameOperationCancelRequested.value = false;
  resetVerificationProgressDetail();
  repairProgressPercent.value = 0;
  repairProgressItems.value = null;
  try {
    await ensureDownloadProgressListener();
    await ensureRepairProgressListener();
    const archive = await resolveReleaseArchiveInfo();
    throwIfGameOperationCancelled();
    activeDownloadBytes.value = archive.sizeBytes || remoteArchiveBytes.value || fallbackRequiredInstallBytes;
    remoteArchiveBytes.value = activeDownloadBytes.value;
    const archiveReady = await invoke<boolean>("validate_downloaded_archive_state", {
      installPath: installPath.value,
      expectedSize: archive.sizeBytes,
      fileName: archive.fileName,
      chunks: archive.chunks ?? [],
      installStage: "merged",
    });
    throwIfGameOperationCancelled();
    if (!archiveReady) {
      repairOperationStage.value = "downloading";
      await invoke("download_game_archive", {
        url: archive.url,
        installPath: installPath.value,
        expectedSize: archive.sizeBytes,
        fileName: archive.fileName,
        chunks: archive.chunks ?? [],
        speedLimitBytesPerSecond: getDownloadSpeedLimitBytes(),
      });
    }
    throwIfGameOperationCancelled();
    repairOperationStage.value = "repairing";
    const summary = await invoke<RepairSummary>("repair_game_from_archive", {
      installPath: installPath.value,
      expectedSize: archive.sizeBytes,
      fileName: archive.fileName,
      chunks: archive.chunks ?? [],
    });
    throwIfGameOperationCancelled();
    repairOperationStage.value = "verifying";
    const verification = await invoke<ManifestVerifySummary>("verify_game_manifest", {
      installPath: installPath.value,
    });
    if (verification.invalidFiles > 0) {
      throw new Error(`修复后仍有 ${verification.invalidFiles} 个异常文件。`);
    }
    console.info("Game integrity verified", summary);
    showCheckResult(`完整性修复完成：检查 ${summary.checkedFiles}，修复 ${summary.repairedFiles}`);
    pendingRepairSummary.value = null;
    downloadedBytes.value = 0;
    downloadedMb.value = 0;
    activeDownloadBytes.value = null;
    remoteArchiveBytes.value = null;
    installStage.value = "downloaded";
    clearUpdateDownloadContext();
    launcherState.value = "ready";
    persistDownloadState("ready", "immediate");
  } catch (error) {
    const interrupted = isGameOperationCancelled(error);
    if (!interrupted) console.error("Unable to repair game files", error);
    launcherState.value = pendingRepairSummary.value ? "repairPending" : "ready";
    if (launcherState.value === "repairPending") persistDownloadState("paused", "immediate");
    if (interrupted) {
      showCheckResult(repairDownloadPauseRequested.value ? "修复下载已暂停。" : "已取消本次修复。");
    } else {
      showCheckResult(`完整性修复失败：${formatUnknownError(error)}`);
    }
  } finally {
    repairOperationStage.value = "idle";
    repairDownloadPauseRequested.value = false;
    gameOperationCancelRequested.value = false;
    if (launcherState.value !== "repairPending") {
      repairProgressPercent.value = 0;
      repairProgressItems.value = null;
    }
  }
}

function requestDeleteGame() {
  confirmAction.value = "deleteGame";
  showDeleteGameConfirm.value = true;
}

function requestUninstallLauncher() {
  confirmAction.value = "uninstallLauncher";
  showDeleteGameConfirm.value = true;
}

function resetDeletedGameState() {
  downloadedMb.value = 0;
  downloadedBytes.value = 0;
  activeDownloadBytes.value = null;
  clearUpdateDownloadContext();
  launcherState.value = "paused";
  clearPersistedDownloadState();
  localGameVersion.value = "";
  remoteGameVersion.value = "";
  pendingRepairSummary.value = null;
}

async function confirmDeleteGame() {
  try {
    await invoke("delete_installed_game", { installPath: installPath.value });
  } catch (error) {
    console.warn("Unable to delete installed game", error);
    showCheckResult(`删除游戏失败：${formatUnknownError(error)}`);
    showDeleteGameConfirm.value = false;
    return;
  }
  resetDeletedGameState();
  showDeleteGameConfirm.value = false;
  showCheckResult("游戏已删除。");
}

async function confirmUninstallLauncher() {
  try {
    showDeleteGameConfirm.value = false;
    await invoke("delete_installed_game", { installPath: installPath.value });
    resetDeletedGameState();
    await invoke("uninstall_launcher");
  } catch (error) {
    console.warn("Unable to uninstall launcher", error);
    showCheckResult(`卸载启动器失败：${formatUnknownError(error)}`);
  }
}

function confirmDangerAction() {
  if (confirmAction.value === "uninstallLauncher") {
    void confirmUninstallLauncher();
    return;
  }
  void confirmDeleteGame();
}

async function minimizeWindow() {
  try {
    await appWindow.minimize();
  } catch (error) {
    console.warn("Unable to minimize launcher window", error);
  }
}

async function hideLauncherWindow() {
  try {
    await appWindow.hide();
  } catch (error) {
    console.warn("Unable to hide launcher window", error);
    await minimizeWindow();
  }
}

async function showLauncherWindow() {
  try {
    await appWindow.show();
    await appWindow.setFocus();
  } catch (error) {
    console.warn("Unable to show launcher window", error);
  }
}

async function closeWindow() {
  try {
    if (closeToTray.value) {
      await hideLauncherWindow();
      return;
    }
    await invoke("exit_launcher");
  } catch (error) {
    console.warn("Unable to close launcher window", error);
    await appWindow.close();
  }
}

async function openQuickLink(item: QuickLink) {
  if (!item.url) return;

  try {
    await openUrl(item.url);
  } catch (error) {
    console.warn("Unable to open launcher quick link", error);
    window.open(item.url, "_blank", "noopener,noreferrer");
  }
}

async function startWindowDrag(event: MouseEvent) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, input, select, textarea, a, [data-no-drag]")) return;

  try {
    await appWindow.startDragging();
  } catch (error) {
    console.warn("Unable to drag launcher window", error);
  }
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (showRemoteLauncherNotice.value) {
    showRemoteLauncherNotice.value = false;
    return;
  }
  if (showDeleteGameConfirm.value) {
    showDeleteGameConfirm.value = false;
    return;
  }
  if (showInstallConfirm.value) {
    showInstallConfirm.value = false;
    return;
  }
  if (showDevPackageConfirm.value) {
    showDevPackageConfirm.value = false;
    return;
  }
  if (showSettings.value) {
    showSettings.value = false;
    return;
  }
  if (showMenu.value) {
    showMenu.value = false;
  }
}
</script>

<template>
  <main
    class="launcher-shell"
    @copy.prevent
    @cut.prevent
    @contextmenu="handleContextMenu"
    @selectstart.prevent
    @mousedown="startWindowDrag"
  >
    <img class="background" src="/launcher/hero-bg.jpeg" alt="" />
    <div class="cinematic-shade"></div>
    <div class="scanlines"></div>
    <div class="drag-surface"></div>

    <Transition name="boot-splash">
      <section v-if="bootSplashVisible" class="boot-splash">
        <div class="boot-splash__grain"></div>
        <div class="boot-splash__center">
          <img class="boot-splash__logo" src="/launcher/logo_white.png" alt="零境启动器" />
          <div class="boot-splash__line">
            <span></span>
          </div>
          <p>{{ bootSplashStatus }}</p>
        </div>
        <strong>Now Loading...</strong>
      </section>
    </Transition>

    <header class="titlebar">
      <section class="brand">
        <img class="brand-logo" src="/launcher/logo_white.png" alt="零境交错" />
      </section>

      <nav class="quick-links" :aria-label="t('nav.quickLinks')">
        <button
          v-for="item in quickLinks"
          :key="item.key"
          class="icon-button"
          :class="{ 'has-qr': item.qr }"
          type="button"
          :aria-label="t(item.labelKey)"
          @click="openQuickLink(item)"
        >
          <img
            class="platform-icon"
            :class="{ compact: item.compact }"
            :src="item.iconSrc"
            alt=""
            aria-hidden="true"
          />
          <span class="button-tooltip quick-tooltip" :class="{ 'qr-tooltip': item.qr }">
            <img v-if="item.qr" class="quick-qr" :src="item.qr" :alt="item.qrAltKey ? t(item.qrAltKey) : t(item.tipKey)" />
            <span>{{ t(item.tipKey) }}</span>
          </span>
        </button>
      </nav>

      <Transition name="traffic-warning">
        <div v-if="showOfficialTrafficWarning" class="traffic-warning" role="status">
          <CircleAlert :size="18" stroke-width="2.8" />
          <span>{{ t("traffic.low") }}</span>
        </div>
      </Transition>

      <section class="window-actions">
        <button
          class="source-pill"
          type="button"
          @click="showSettings = true; activeSettingsTab = 'download'"
        >
          <span>下载源</span>
          <strong>{{ t(selectedDownloadSource.nameKey) }}</strong>
          <em class="button-tooltip source-tooltip">{{ selectedDownloadSourceDescription }}</em>
        </button>
        <button class="plain-icon" type="button" :aria-label="t('window.settings')" @click="showSettings = true">
          <Settings :size="22" stroke-width="2.6" />
          <span class="button-tooltip">{{ t("window.settings") }}</span>
        </button>
        <button class="plain-icon" type="button" :aria-label="t('window.minimize')" @click="minimizeWindow">
          <Minus :size="22" stroke-width="2.8" />
          <span class="button-tooltip">{{ t("window.minimize") }}</span>
        </button>
        <button class="plain-icon close" type="button" :aria-label="t('window.close')" @click="closeWindow">
          <X :size="22" stroke-width="2.8" />
          <span class="button-tooltip">{{ t("window.close") }}</span>
        </button>
      </section>
    </header>

    <section class="left-stack" :class="{ collapsed: leftCollapsed }">
      <article class="promo-panel" :class="{ video: activeNewsTab === 'video' }">
        <div class="tab-row">
          <button
            v-for="tab in newsTabs"
            :key="tab.key"
            class="news-tab"
            :class="{ active: activeNewsTab === tab.key }"
            type="button"
            @click="activeNewsTab = tab.key"
          >
            {{ t(tab.labelKey) }}
          </button>
        </div>
        <div
          class="news-content"
          @mouseenter="stopCharacterBannerRotation"
          @mouseleave="startCharacterBannerRotation"
        >
          <Transition name="news-page-motion">
            <div :key="activeNewsTab" class="news-page">
          <div class="promo-image">
            <iframe
              v-if="currentEmbeddedVideo"
              :key="currentEmbeddedVideo"
              class="promo-video"
              :src="currentEmbeddedVideo"
              allow="autoplay; encrypted-media; fullscreen"
              referrerpolicy="no-referrer"
            ></iframe>
            <video
              v-else-if="currentDirectVideo"
              :key="currentDirectVideo"
              class="promo-video"
              :src="currentDirectVideo"
              autoplay
              loop
              muted
              playsinline
            ></video>
            <Transition v-else name="banner-fade">
              <img :key="currentPromoBanner" :src="currentPromoBanner" alt="" @error="handlePromoImageError" />
            </Transition>
          </div>
          <section v-if="activeNewsTab === 'characters'" class="character-profile">
            <h3>{{ activeCharacterProfile.name }}</h3>
            <p>{{ activeCharacterProfile.work }}</p>
            <div class="character-tags">
              <span v-for="tag in activeCharacterProfile.tags" :key="tag">{{ tag }}</span>
            </div>
          </section>
          <section v-else-if="activeNewsTab === 'notice'" class="notice-board">
            <header>
              <h3>{{ noticeBoard.title }}</h3>
              <p>{{ noticeBoard.subtitle }}</p>
            </header>
            <article v-for="section in noticeBoard.sections" :key="section.title" class="notice-section">
              <h4>{{ section.title }}</h4>
              <ul>
                <li v-for="item in section.items" :key="item">{{ item }}</li>
              </ul>
            </article>
          </section>
          <ul v-else class="news-list">
            <li
              v-for="item in activeNewsItems"
              :key="item.title"
              :class="{ active: activeNewsTab === 'video' && activeVideo?.title === item.title }"
              @click="activeNewsTab === 'video' && (activeVideo = item as VideoItem)"
            >
              <span>{{ item.title }}</span>
              <time>{{ item.date }}</time>
            </li>
          </ul>
            </div>
          </Transition>
        </div>
      </article>

      <article class="profile-panel">
        <div class="profile-head">
          <button class="swap-button" type="button" title="切换账号">
            <RefreshCw :size="24" />
          </button>
          <div>
            <h2>晓桀</h2>
            <p>{{ t("profile.featureCode") }} <strong>100019793</strong></p>
          </div>
          <button class="sync-button" type="button" title="刷新数据">
            <RefreshCw :size="22" />
          </button>
        </div>
        <div class="resource-grid">
          <div class="resource-item cyan">
            <span class="gem"></span>
            <strong>3</strong>
            <small>/240</small>
            <em>23小时37分钟</em>
          </div>
          <div class="resource-item amber">
            <span class="coin"></span>
            <strong>100</strong>
            <small>/100</small>
            <em>{{ t("profile.weeklyActive") }}</em>
          </div>
          <div class="resource-item green">
            <span class="gem"></span>
            <strong>115</strong>
            <small>/480</small>
            <em>{{ t("profile.resourceReserve") }}</em>
          </div>
          <div class="resource-item slate">
            <span class="disc"></span>
            <strong>9750</strong>
            <small>/12000</small>
            <em>{{ t("profile.level") }} 67</em>
          </div>
        </div>
        <p class="profile-note">{{ t("profile.note") }}</p>
      </article>
    </section>

    <section class="right-launcher">
      <section class="hero-copy" :class="{ raised: showDownloadProgress }">
        <h2>{{ t("brand.title") }}</h2>
        <div class="collab-line">
          <span>Crossing Void</span>
          <i></i>
          <span>illusion Dreamland</span>
        </div>
      </section>

      <section class="download-dock">
        <Transition name="download-progress-fade">
          <div v-if="showDownloadProgress && !compactStatusLine" class="download-progress-block" :class="{ warning: launcherState === 'repairPending' }">
            <div class="download-state" :class="{ compact: compactStatusLine }">
              <span :title="verificationFileTitle || undefined">{{ statusCopy }}</span>
              <strong
                v-if="
                  showProgressNumbers &&
                  !developerTaskActive &&
                  !launcherUpdateActive &&
                  launcherUpdateConfirmStage !== 'available' &&
                  launcherState !== 'installing' &&
                  launcherState !== 'checking' &&
                  launcherState !== 'repairPending' &&
                  launcherState !== 'repairing'
                "
                class="download-size"
              >
                <span>{{ displayedProgressMb.toFixed(1) }}/{{ totalMb.toFixed(1) }}</span>
                <em>MB</em>
              </strong>
              <strong v-else-if="developerTaskProgressDetail" class="download-size install-detail">
                <span :title="developerTaskProgressDetail">{{ developerTaskProgressDetail }}</span>
              </strong>
              <strong v-else-if="launcherUpdateProgressDetail" class="download-size install-detail">
                <span>{{ launcherUpdateProgressDetail }}</span>
              </strong>
              <strong v-else-if="installProgressDetail" class="download-size install-detail">
                <span>{{ installProgressDetail }}</span>
              </strong>
              <strong v-else-if="repairProgressDetail" class="download-size install-detail">
                <span>{{ repairProgressDetail }}</span>
              </strong>
              <strong v-if="repairMissingDetail" class="download-size repair-missing-detail">
                <span>{{ repairMissingDetail }}</span>
              </strong>
              <strong v-if="downloadEstimateCopy" class="download-time">{{ downloadEstimateCopy }}</strong>
              <b v-if="showProgressNumbers">{{ progressPercent }}%</b>
            </div>
            <div v-if="verificationByteProgress || verificationIssueCopy" class="verification-detail">
              <span v-if="verificationByteProgress">{{ verificationByteProgress }}</span>
              <strong v-if="verificationIssueCopy">{{ verificationIssueCopy }}</strong>
            </div>
            <div v-if="showProgressTrack" class="progress-track">
              <div
                class="progress-fill"
                :class="{
                  active:
                    versionCheckPending ||
                    (developerTaskActive && !developerTaskPaused) ||
                    launcherUpdateActive ||
                    launcherState === 'downloading' ||
                    launcherState === 'installing' ||
                    launcherState === 'checking' ||
                    launcherState === 'repairing',
                  warning: launcherState === 'repairPending',
                }"
                :style="{ width: `${progressPercent}%` }"
              ></div>
            </div>
          </div>
        </Transition>
        <Transition name="download-progress-fade">
          <div v-if="compactStatusLine || (lastCheckMessage && !showDownloadProgress)" class="check-result-line">
            {{ compactStatusLine ? statusCopy : lastCheckMessage }}
          </div>
        </Transition>
        <div class="dock-actions">
          <button
            class="menu-button"
            type="button"
            :disabled="menuActionDisabled"
            :class="{ disabled: menuActionDisabled }"
            @click="toggleToolMenu"
            @mouseenter="!menuActionDisabled && cancelToolMenuClose()"
            @mouseleave="!menuActionDisabled && scheduleToolMenuClose()"
          >
            <Menu :size="38" />
          </button>
          <button
            class="primary-action"
            type="button"
            :disabled="primaryActionDisabled"
            :class="{ disabled: primaryActionDisabled, warning: launcherState === 'repairPending' }"
            @click="handlePrimaryAction"
          >
            <component
              :is="actionIcon"
              :size="38"
              :class="{ spinning: primaryActionSpinning }"
            />
            <span>{{ actionCopy }}</span>
          </button>
        </div>
        <Transition name="tool-menu-pop">
          <div
            v-if="showMenu"
            class="tool-menu"
            @mouseenter="cancelToolMenuClose"
            @mouseleave="scheduleToolMenuClose"
          >
            <button type="button" @click="openLocalGameFiles">
              <FolderOpen :size="20" />
              <span>{{ t("tool.openLocalFiles") }}</span>
            </button>
            <button type="button" :disabled="!canVerifyGameIntegrity || versionCheckPending || gameLaunchPending || gameRunning" @click="verifyGameIntegrity">
              <Wrench :size="20" />
              <span>{{ t("tool.verifyIntegrity") }}</span>
            </button>
            <button type="button" :disabled="!canCheckGameUpdates || offlineMode || versionCheckPending || gameLaunchPending || gameRunning" @click="checkForUpdates">
              <RefreshCw :size="20" />
              <span>{{ t("tool.checkUpdates") }}</span>
            </button>
            <button type="button" class="tool-menu-toggle" :class="{ active: useDx11 }" :disabled="gameLaunchPending || gameRunning" @click="useDx11 = !useDx11">
              <span class="menu-check" aria-hidden="true">
                <Check v-if="useDx11" :size="14" />
              </span>
              <span>{{ t("tool.useDx11") }}</span>
            </button>
            <button type="button" class="tool-menu-toggle" :class="{ active: offlineMode }" @click="toggleOfflineMode">
              <span class="menu-check" aria-hidden="true">
                <Check v-if="offlineMode" :size="14" />
              </span>
              <span>{{ t("tool.offlineMode") }}</span>
            </button>
          </div>
        </Transition>
      </section>
    </section>

    <button
      class="side-handle"
      :class="{ collapsed: leftCollapsed }"
      type="button"
      :title="leftCollapsed ? t('side.expand') : t('side.collapse')"
      @click="leftCollapsed = !leftCollapsed"
    >
      <ChevronLeft :size="30" stroke-width="3.2" />
    </button>

    <section class="version-corner" aria-label="version info">
      <span>{{ t("settings.gameVersion") }}：{{ displayedGameVersion }}</span>
      <span>{{ t("settings.launcherVersion") }}：{{ launcherVersion }}</span>
    </section>

    <Transition name="install-pop">
      <div
        v-if="showInstallConfirm"
        class="install-mask"
        data-no-drag
        @click.self="showInstallConfirm = false"
      >
        <section class="install-panel" :aria-label="t('install.title')">
          <button class="install-close" type="button" :aria-label="t('install.close')" @click="showInstallConfirm = false">
            <X :size="23" stroke-width="2.5" />
          </button>
          <h2>{{ t("install.title") }}</h2>
          <div class="install-path-row">
            <span>{{ finalInstallPath }}</span>
            <button type="button" @click="chooseInstallPath">{{ t("install.change") }}</button>
          </div>
          <div class="install-space-row">
            <span>{{ t("install.requiredSpace") }}：{{ requiredSpaceCopy }}</span>
            <i></i>
            <span :class="{ danger: isInstallSpaceLow }">{{ t("install.availableSpace") }}：{{ availableSpaceCopy }}</span>
          </div>
          <button
            class="install-option"
            :class="{ checked: createDesktopShortcut }"
            type="button"
            @click="createDesktopShortcut = !createDesktopShortcut"
          >
            <span class="check-box"><Check :size="21" stroke-width="3.2" /></span>
            <strong>{{ t("install.desktopShortcut") }}</strong>
          </button>
          <button class="install-continue" type="button" @click="confirmInstallPathAndDownload">
            {{ t("install.continue") }}
          </button>
        </section>
      </div>
    </Transition>

    <Transition name="settings-layer">
      <div v-if="showSettings" class="modal-mask settings-mask" @click.self="showSettings = false">
        <section class="settings-modal" :aria-label="t('window.settings')">
        <aside class="settings-sidebar">
          <button
            v-for="tab in settingsTabs"
            :key="tab.key"
            class="settings-tab"
            :class="{ active: activeSettingsTab === tab.key, disabled: tab.key === 'game' && gameSettingsDisabled }"
            type="button"
            :disabled="tab.key === 'game' && gameSettingsDisabled"
            @click="selectSettingsTab(tab.key)"
          >
            <component :is="tab.icon" :size="22" stroke-width="3" />
            <span>{{ t(tab.labelKey) }}</span>
          </button>
        </aside>

        <section class="settings-content">
          <header class="settings-header">
            <div class="settings-title-stage">
              <Transition name="settings-title-motion">
                <h2 :key="activeSettingsTab">{{ settingsTitle }}</h2>
              </Transition>
            </div>
          </header>

          <div class="settings-divider" aria-hidden="true"></div>

          <div class="settings-scroll-frame">
            <div ref="settingsScrollEl" class="settings-scroll" data-no-drag @scroll="updateSettingsScrollbar">
              <div class="settings-page-stage">
                <Transition name="settings-page-motion">
                <section v-if="activeSettingsTab === 'preferences'" :key="activeSettingsTab" class="settings-page" data-settings-page="preferences">
              <div class="setting-block">
                <span class="setting-title">{{ t("settings.launcherLanguage") }}</span>
                <p class="setting-hint">{{ t("settings.launcherLanguageHint") }}</p>
                <LauncherSelect v-model="launcherLanguage" :options="launcherLanguages" />
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.closeWindow") }}</span>
                <button class="radio-row" :class="{ checked: !closeToTray }" type="button" @click="closeToTray = false">
                  <span class="radio-dot"></span>
                  <strong>{{ t("settings.exitLauncher") }}</strong>
                </button>
                <button class="radio-row" :class="{ checked: closeToTray }" type="button" @click="closeToTray = true">
                  <span class="radio-dot"></span>
                  <strong>{{ t("settings.minimizeToTray") }}</strong>
                </button>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.display") }}</span>
                <button
                  class="check-row"
                  :class="{ checked: hideAfterGameLaunch }"
                  type="button"
                  @click="hideAfterGameLaunch = !hideAfterGameLaunch"
                >
                  <span class="check-box"><Check :size="22" stroke-width="3.2" /></span>
                  <strong>{{ t("settings.hideAfterGameLaunch") }}</strong>
                </button>
              </div>
                </section>

                <section v-else-if="activeSettingsTab === 'download'" :key="activeSettingsTab" class="settings-page" data-settings-page="download">
              <div class="setting-block">
                <span class="setting-title">{{ t("settings.downloadSource") }}</span>
                <p class="setting-hint">{{ selectedDownloadSourceDescription }}</p>
                <LauncherSelect
                  v-model="downloadSourceModel"
                  :options="downloadSourceOptions"
                  :disabled="downloadSourceDisabled"
                />
                <p v-if="downloadSource === 'official'" class="traffic-quota__notice" :class="{ low: officialTrafficBlocked }">
                  {{ t(officialTrafficBlocked ? "traffic.lowHint" : "traffic.supportHint") }}
                </p>
                <div
                  v-if="downloadSource === 'official'"
                  class="traffic-quota"
                  :class="{ low: officialTrafficBlocked, unavailable: trafficQuota && !trafficQuota.available }"
                >
                  <div class="traffic-quota__header">
                    <span>{{ t("traffic.title") }}</span>
                    <strong>{{ trafficQuotaRemainingText }}</strong>
                  </div>
                  <div v-if="trafficQuota?.available" class="traffic-quota__track" aria-hidden="true">
                    <span :style="{ width: `${trafficQuotaPercent}%` }"></span>
                  </div>
                  <small v-if="trafficQuotaExpiryText">{{ trafficQuotaExpiryText }}</small>
                </div>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.downloadSpeed") }}</span>
                <button class="radio-row" :class="{ checked: !downloadLimited }" type="button" @click="downloadLimited = false">
                  <span class="radio-dot"></span>
                  <strong>{{ t("settings.unlimited") }}</strong>
                </button>
                <div class="limit-row">
                  <button class="radio-row" :class="{ checked: downloadLimited }" type="button" @click="downloadLimited = true">
                    <span class="radio-dot"></span>
                    <strong>{{ t("settings.limited") }}</strong>
                  </button>
                  <input v-model="speedLimit" class="speed-input" inputmode="decimal" />
                  <span class="speed-unit">MB/s（1-100）</span>
                </div>
              </div>

                </section>

                <section v-else-if="activeSettingsTab === 'game'" :key="activeSettingsTab" class="settings-page" data-settings-page="game">
              <label class="setting-block">
                <span class="setting-title">{{ t("settings.installPath") }}</span>
                <input v-model="installPath" class="path-input" />
              </label>

              <div class="game-actions">
                <button type="button" @click="openLocalGameFiles">
                  <FolderOpen :size="22" />
                  <span>{{ t("settings.openGameFolder") }}</span>
                </button>
                <button type="button" @click="relocateInstalledGame">
                  <RotateCcw :size="22" />
                  <span>{{ t("settings.relocateGame") }}</span>
                </button>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.gameLog") }}</span>
                <button class="light-action" type="button">
                  <FileText :size="22" />
                  <span>{{ t("settings.openGameLog") }}</span>
                </button>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.gameManagement") }}</span>
                <div class="game-actions">
                  <button class="danger-action" type="button" @click="requestDeleteGame">
                    <Trash2 :size="22" />
                    <span>{{ t("settings.deleteGame") }}</span>
                  </button>
                  <button class="danger-action danger-action-muted" type="button" @click="requestUninstallLauncher">
                    <PackageOpen :size="22" />
                    <span>{{ t("settings.uninstallLauncher") }}</span>
                  </button>
                </div>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.otherLaunchOptions") }}</span>
                <div class="setting-line">
                  <div>
                    <strong>{{ t("settings.autoRepair") }}</strong>
                    <p>{{ t("settings.autoRepairHint") }}</p>
                  </div>
                  <button class="switch" :class="{ on: autoRepair }" type="button" @click="autoRepair = !autoRepair">
                    <span></span>
                  </button>
                </div>
              </div>
                </section>

                <section v-else-if="activeSettingsTab === 'about'" :key="activeSettingsTab" class="settings-page" data-settings-page="about">
              <div class="setting-block">
                <span class="setting-title">{{ t("settings.aboutLauncher") }}</span>
                <p class="about-line">{{ t("settings.launcherVersion") }}：{{ launcherVersion }}</p>
                <button class="light-action" type="button" :disabled="launcherUpdatePending" @click="checkLauncherUpdate({ manual: true })">
                  <RefreshCw :size="22" :class="{ spinning: launcherUpdatePending }" />
                  <span>{{ launcherUpdatePending ? t("settings.checkingLauncherUpdate") : t("settings.checkVersion") }}</span>
                </button>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.launcherLog") }}</span>
                <button class="light-action" type="button" @click="openLauncherLogFolder">
                  <FileText :size="22" />
                  <span>{{ t("settings.openLogFolder") }}</span>
                </button>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.termsPolicy") }}</span>
                <a href="#">{{ t("settings.userAgreement") }}</a>
                <a href="#">{{ t("settings.privacyPolicy") }}</a>
              </div>
                </section>

                <section
                  v-else-if="activeSettingsTab === 'developer'"
                  :key="activeSettingsTab"
                  class="settings-page"
                  data-settings-page="developer"
                >
              <div class="setting-block">
                <span class="setting-title">{{ t("dev.setVersion") }}</span>
                <p class="setting-hint">{{ developerVersionHint }}</p>
                <div class="developer-version-row">
                  <input v-model="developerVersionInput" class="path-input" />
                  <button class="light-action" type="button" :disabled="developerTaskActive" @click="saveDeveloperLauncherVersion">
                    <Check :size="22" />
                    <span>{{ t("dev.setVersion") }}</span>
                  </button>
                </div>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("dev.packageLauncher") }}</span>
                <button class="light-action" type="button" :disabled="developerTaskActive" @click="showDevPackageConfirm = true">
                  <PackageOpen :size="22" />
                  <span>{{ developerTaskPending ? t("dev.running") : t("dev.packageLauncher") }}</span>
                </button>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("dev.publishLauncher") }}</span>
                <button class="light-action" type="button" :disabled="developerTaskActive" @click="publishDeveloperLauncherPackage">
                  <HardDriveDownload :size="22" />
                  <span>{{ developerTaskPending ? t("dev.running") : t("dev.publishLauncher") }}</span>
                </button>
              </div>

              <div class="setting-block developer-game-publish-block">
                <span class="setting-title">上传游戏本体</span>
                <p class="setting-hint">PC 会过滤调试和临时文件；Android 会自动定位唯一的 APK 与 main OBB。</p>
                <div class="developer-game-metadata">
                  <label>
                    <span>游戏版本</span>
                    <input v-model="developerGameVersion" class="path-input" placeholder="V0.5.12" />
                  </label>
                  <label>
                    <span>发布标题</span>
                    <input v-model="developerGameTitle" class="path-input" maxlength="100" />
                  </label>
                </div>
                <div class="developer-game-actions">
                  <button class="light-action" type="button" :disabled="developerTaskActive" @click="publishDeveloperGamePackage('Windows', 'Stable')">
                    <PackageOpen :size="22" />
                    <span>上传 PC 游戏包</span>
                  </button>
                  <button class="light-action" type="button" :disabled="developerTaskActive" @click="publishDeveloperGamePackage('Android', 'Stable')">
                    <HardDriveDownload :size="22" />
                    <span>上传 Android 游戏包</span>
                  </button>
                  <button class="light-action test-server-action" type="button" :disabled="developerTaskActive" @click="publishDeveloperGamePackage('Windows', 'Test')">
                    <PackageOpen :size="22" />
                    <span>上传 PC 测试服游戏包</span>
                  </button>
                  <button class="light-action test-server-action" type="button" :disabled="developerTaskActive" @click="publishDeveloperGamePackage('Android', 'Test')">
                    <HardDriveDownload :size="22" />
                    <span>上传 Android 测试服游戏包</span>
                  </button>
                </div>
              </div>

              <div class="setting-block developer-notice-block">
                <span class="setting-title">远程公告</span>
                <p class="setting-hint">{{ developerNoticeStatus }}</p>
                <input
                  v-model="developerNoticeTitle"
                  class="path-input developer-notice-title"
                  maxlength="80"
                  placeholder="公告标题"
                />
                <textarea
                  v-model="developerNoticeContent"
                  class="developer-notice-content"
                  maxlength="2000"
                  placeholder="公告正文"
                ></textarea>
                <div class="developer-notice-levels" aria-label="公告级别">
                  <button
                    v-for="option in ([
                      { value: 'info', label: '普通' },
                      { value: 'warning', label: '警告' },
                      { value: 'error', label: '错误' },
                    ] as const)"
                    :key="option.value"
                    type="button"
                    :class="[option.value, { active: developerNoticeLevel === option.value }]"
                    @click="developerNoticeLevel = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <div class="developer-notice-actions">
                  <button class="light-action" type="button" :disabled="developerNoticePending" @click="publishDeveloperRemoteNotice(true)">
                    <Megaphone :size="22" />
                    <span>{{ developerNoticePending ? "正在处理" : "发布公告" }}</span>
                  </button>
                  <button class="light-action developer-notice-disable" type="button" :disabled="developerNoticePending" @click="publishDeveloperRemoteNotice(false)">
                    <BellOff :size="22" />
                    <span>关闭公告</span>
                  </button>
                </div>
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("dev.openProjectFolder") }}</span>
                <button class="light-action" type="button" @click="openDeveloperProjectFolder">
                  <FolderOpen :size="22" />
                  <span>{{ t("dev.openProjectFolder") }}</span>
                </button>
              </div>
                </section>
                </Transition>
              </div>
              <div class="settings-scroll-spacer" :style="{ height: `${settingsScrollSpacer}px` }" aria-hidden="true"></div>
            </div>
          </div>
        </section>

        </section>
        <div
          class="settings-scrollbar-rail"
          :class="{ visible: showSettingsScrollbar }"
          :style="settingsScrollbarFrameStyle"
          aria-hidden="true"
        >
          <span :style="{ transform: `translateY(${settingsScrollbarThumbTop}px)` }"></span>
        </div>
        <button class="settings-close" type="button" @click="showSettings = false" :title="t('window.close')" data-no-drag>
          <ArrowLeft :size="37" stroke-width="2.8" aria-hidden="true" />
        </button>
        <Transition name="confirm-pop">
          <div
            v-if="showDeleteGameConfirm"
            class="confirm-mask"
            data-no-drag
            @click.self="showDeleteGameConfirm = false"
          >
            <section
              class="confirm-panel"
              :aria-label="confirmAction === 'uninstallLauncher' ? t('confirm.uninstallLauncherTitle') : t('confirm.deleteTitle')"
            >
              <h3>{{ confirmAction === "uninstallLauncher" ? t("confirm.uninstallLauncherTitle") : t("confirm.deleteTitle") }}</h3>
              <p>{{ confirmAction === "uninstallLauncher" ? t("confirm.uninstallLauncherBody") : t("confirm.deleteBody") }}</p>
              <div class="confirm-actions">
                <button class="confirm-delete" type="button" @click="confirmDangerAction">
                  {{ confirmAction === "uninstallLauncher" ? t("confirm.uninstallLauncher") : t("confirm.delete") }}
                </button>
                <button class="confirm-cancel" type="button" @click="showDeleteGameConfirm = false">
                  {{ t("confirm.cancel") }}
                </button>
              </div>
            </section>
          </div>
        </Transition>
      </div>
    </Transition>

    <Transition name="install-pop">
      <div v-if="showDevPackageConfirm" class="install-mask" data-no-drag @click.self="showDevPackageConfirm = false">
        <section class="install-panel dev-package-panel" :aria-label="t('dev.packageTitle')">
          <button class="install-close" type="button" :aria-label="t('install.close')" @click="showDevPackageConfirm = false">
            <X :size="22" />
          </button>
          <h2>{{ t("dev.packageTitle") }}</h2>
          <p class="dev-package-note">{{ t("dev.packagePath") }}</p>
          <div class="install-path-row">
            <span>{{ developerPackagePath }}</span>
            <button type="button" @click="chooseDeveloperPackagePath">{{ t("dev.choosePath") }}</button>
          </div>
          <button class="install-continue" type="button" :disabled="developerTaskActive" @click="runDeveloperLauncherBuild">
            {{ developerTaskPending ? t("dev.running") : t("dev.startPackage") }}
          </button>
        </section>
      </div>
    </Transition>

    <Transition name="confirm-pop">
      <div v-if="showRemoteLauncherNotice && remoteLauncherNotice" class="remote-notice-mask" data-no-drag>
        <section class="remote-notice-panel" :class="remoteLauncherNotice.level" aria-label="远程公告">
          <header>
            <CircleAlert :size="34" stroke-width="2.5" />
            <div>
              <span>远程公告</span>
              <h2>{{ remoteLauncherNotice.title }}</h2>
            </div>
          </header>
          <p>{{ remoteLauncherNotice.content }}</p>
          <button type="button" @click="showRemoteLauncherNotice = false">{{ t("window.close") }}</button>
        </section>
      </div>
    </Transition>
  </main>
</template>

<style>
@font-face {
  font-family: "SJBangshu";
  src: url("/launcher/SanJiBangShuJianTi-2.ttf") format("truetype");
  font-display: swap;
}

@font-face {
  font-family: "UnispaceCV";
  src: url("/launcher/unispace_bd.ttf") format("truetype");
  font-display: swap;
}

:root {
  --cv-theme-default-accent: #d2aa5c;
  --cv-theme-default-support: #0d1214;
  --cv-theme-accent: var(--cv-theme-default-accent);
  --cv-theme-support: var(--cv-theme-default-support);
  --cv-bg-page: color-mix(in srgb, var(--cv-theme-support) 82%, black);
  --cv-bg-deep: color-mix(in srgb, var(--cv-theme-support) 68%, black);
  --cv-bg-surface: color-mix(in srgb, var(--cv-theme-support) 93%, var(--cv-theme-accent) 7%);
  --cv-bg-surface-cool: color-mix(in srgb, var(--cv-theme-support) 94%, #243a3a 6%);
  --cv-bg-surface-soft: color-mix(in srgb, var(--cv-theme-support) 92%, white 8%);
  --cv-accent-soft: color-mix(in srgb, var(--cv-theme-accent) 72%, white 28%);
  --cv-accent-title: color-mix(in srgb, var(--cv-theme-accent) 58%, #ffe2a3 42%);
  --cv-accent-muted: color-mix(in srgb, var(--cv-theme-accent) 74%, var(--cv-theme-support) 26%);
  --cv-accent-glow: color-mix(in srgb, var(--cv-theme-accent) 22%, transparent);
  --cv-accent-glow-soft: color-mix(in srgb, var(--cv-theme-accent) 14%, transparent);
  --cv-accent-line: color-mix(in srgb, var(--cv-theme-accent) 38%, transparent);
  --cv-icon-hover-bg: color-mix(in srgb, var(--cv-theme-accent) 30%, transparent);
  --cv-icon-hover-color: color-mix(in srgb, var(--cv-theme-accent) 64%, white 36%);
  --cv-download-progress-start: color-mix(in srgb, var(--cv-theme-accent) 68%, #ffe45d 32%);
  --cv-download-progress-end: color-mix(in srgb, var(--cv-theme-accent) 36%, #fff4b8 64%);
  --cv-download-progress-border: color-mix(in srgb, var(--cv-download-progress-end) 78%, transparent);
  --cv-download-progress-glow: color-mix(in srgb, var(--cv-download-progress-start) 62%, transparent);
  --cv-panel-accent: color-mix(in srgb, var(--cv-theme-accent) 48%, #ffe28f 52%);
  --cv-panel-accent-strong: color-mix(in srgb, var(--cv-panel-accent) 82%, white 18%);
  --cv-panel-accent-soft: color-mix(in srgb, var(--cv-panel-accent) 58%, transparent);
  --cv-form-border: color-mix(in srgb, var(--cv-accent-soft) 42%, transparent);
  --cv-form-border-strong: color-mix(in srgb, var(--cv-accent-soft) 72%, transparent);
  --cv-check-accent: color-mix(in srgb, var(--cv-accent-title) 78%, var(--cv-theme-accent) 22%);
  --cv-check-accent-dark: color-mix(in srgb, var(--cv-theme-accent) 76%, var(--cv-theme-support) 24%);
  --cv-check-accent-glow: color-mix(in srgb, var(--cv-check-accent) 18%, transparent);
  --cv-support-line: color-mix(in srgb, var(--cv-theme-support) 72%, white 28%);
  --cv-support-line-soft: color-mix(in srgb, var(--cv-support-line) 62%, transparent);

  font-family:
    "Microsoft YaHei UI",
    "Segoe UI",
    sans-serif;
  color: #f8fbff;
  background: var(--cv-bg-deep);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

button,
input {
  font: inherit;
}

button {
  color: inherit;
  cursor: pointer;
}

button,
input,
select,
textarea,
a,
[data-no-drag] {
  app-region: no-drag;
  -webkit-app-region: no-drag;
}
</style>

<style scoped>
.launcher-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  min-width: 1200px;
  min-height: 675px;
  overflow: hidden;
  isolation: isolate;
  background: var(--cv-bg-page);
  user-select: none;
  -webkit-user-select: none;
}

.background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.025);
  z-index: -4;
}

.cinematic-shade {
  position: absolute;
  inset: 0;
  z-index: -3;
  background:
    radial-gradient(circle at 82% 42%, var(--cv-accent-glow), transparent 23%),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--cv-bg-deep) 72%, transparent),
      color-mix(in srgb, var(--cv-bg-deep) 15%, transparent) 48%,
      color-mix(in srgb, var(--cv-bg-deep) 78%, transparent)
    ),
    linear-gradient(
      0deg,
      color-mix(in srgb, var(--cv-bg-page) 92%, transparent),
      color-mix(in srgb, var(--cv-bg-page) 8%, transparent) 52%,
      color-mix(in srgb, var(--cv-bg-page) 52%, transparent)
    );
}

.scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -2;
  opacity: 0.2;
  background-image: linear-gradient(rgba(255, 255, 255, 0.12) 1px, transparent 1px);
  background-size: 100% 5px;
}

.boot-splash {
  position: absolute;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    linear-gradient(115deg, color-mix(in srgb, var(--cv-bg-deep) 94%, black), color-mix(in srgb, var(--cv-bg-page) 82%, black)),
    var(--cv-bg-page);
  pointer-events: auto;
}

.boot-splash::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 72% 38%, color-mix(in srgb, var(--cv-accent-title) 16%, transparent), transparent 23%),
    linear-gradient(120deg, transparent 0 38%, color-mix(in srgb, white 9%, transparent) 46%, transparent 55% 100%);
  opacity: 0.88;
}

.boot-splash::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(color-mix(in srgb, white 13%, transparent) 1px, transparent 1px);
  background-size: 100% 5px;
  opacity: 0.18;
}

.boot-splash__grain {
  position: absolute;
  inset: -20%;
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0 16px,
      color-mix(in srgb, var(--cv-accent-title) 5%, transparent) 17px,
      transparent 18px 35px
    );
  opacity: 0.2;
  transform: rotate(-10deg);
  animation: boot-grain-drift 6s linear infinite;
}

.boot-splash__center {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 18px;
  transform: translate(-100px, -56px);
}

.boot-splash__logo {
  width: 286px;
  max-width: 36vw;
  height: auto;
  object-fit: contain;
  filter:
    drop-shadow(0 12px 18px rgba(0, 0, 0, 0.62))
    drop-shadow(0 0 20px color-mix(in srgb, var(--cv-accent-title) 25%, transparent));
  animation: boot-logo-breathe 2.4s ease-in-out infinite;
}

.boot-splash__line {
  position: relative;
  width: 284px;
  height: 8px;
  max-width: 36vw;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cv-download-progress-end) 46%, transparent);
  background: color-mix(in srgb, var(--cv-bg-deep) 66%, transparent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--cv-download-progress-start) 20%, transparent);
  transform: skewX(-16deg);
}

.boot-splash__line span {
  position: absolute;
  inset: 1px;
  width: 44%;
  background: linear-gradient(
    90deg,
    transparent,
    var(--cv-download-progress-start),
    var(--cv-download-progress-end),
    transparent
  );
  filter: drop-shadow(0 0 10px var(--cv-download-progress-glow));
  animation: boot-line-sweep 1.18s linear infinite;
}

.boot-splash p {
  margin: 0;
  color: color-mix(in srgb, var(--cv-accent-title) 82%, white 18%);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.56);
}

.boot-splash > strong {
  position: absolute;
  right: 66px;
  bottom: 44px;
  z-index: 1;
  color: color-mix(in srgb, var(--cv-accent-title) 82%, white 18%);
  font-family: "UnispaceCV", "Segoe UI", sans-serif;
  font-size: 18px;
  font-weight: 950;
  letter-spacing: 0;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.65);
}

.boot-splash-enter-active,
.boot-splash-leave-active {
  transition:
    opacity 340ms ease,
    filter 340ms ease;
}

.boot-splash-enter-from,
.boot-splash-leave-to {
  opacity: 0;
  filter: blur(8px);
}

@keyframes boot-line-sweep {
  from {
    transform: translateX(-120%);
  }
  to {
    transform: translateX(250%);
  }
}

@keyframes boot-logo-breathe {
  0%,
  100% {
    opacity: 0.92;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.018);
  }
}

@keyframes boot-grain-drift {
  from {
    transform: translateX(-3%) rotate(-10deg);
  }
  to {
    transform: translateX(3%) rotate(-10deg);
  }
}

.drag-surface {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.titlebar {
  position: relative;
  height: 72px;
  z-index: 30;
}

.brand {
  position: absolute;
  left: 42px;
  top: 12px;
  display: flex;
  align-items: center;
  min-width: 0;
}

.brand-logo {
  width: 148px;
  height: auto;
  object-fit: contain;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.55));
}

.quick-links {
  position: absolute;
  left: 322px;
  top: 16px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  min-width: 0;
}

.icon-button,
.plain-icon,
.swap-button,
.sync-button,
.menu-button {
  border: 0;
  background: rgba(0, 11, 18, 0.62);
  color: #fff;
  display: grid;
  place-items: center;
  transition:
    transform 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.icon-button {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.platform-icon {
  width: 23px;
  height: 23px;
  display: block;
  object-fit: contain;
  pointer-events: none;
}

.platform-icon.compact {
  width: 18.4px;
  height: 18.4px;
}

.icon-button:hover,
.plain-icon:hover,
.menu-button:hover,
.swap-button:hover,
.sync-button:hover {
  transform: translateY(-1px);
  background: var(--cv-icon-hover-bg);
  color: var(--cv-icon-hover-color);
}

.window-actions {
  position: fixed;
  right: 50px;
  top: 17px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
  z-index: 100;
}

.traffic-warning {
  position: fixed;
  right: 50px;
  top: 61px;
  z-index: 99;
  min-height: 34px;
  padding: 0 13px;
  border: 1px solid rgba(255, 121, 105, 0.52);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(48, 12, 12, 0.92);
  color: #ffd8cf;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.36);
  font-size: 13px;
  font-weight: 950;
  pointer-events: none;
}

.traffic-warning-enter-active,
.traffic-warning-leave-active {
  transition: opacity 160ms ease, transform 180ms ease;
}

.traffic-warning-enter-from,
.traffic-warning-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.source-pill {
  position: relative;
  flex: 0 0 auto;
  height: 34px;
  min-width: 120px;
  max-width: 158px;
  padding: 0 13px;
  border: 0;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: rgba(0, 11, 18, 0.68);
  color: rgba(255, 255, 255, 0.88);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cv-accent-title) 22%, transparent);
  transition:
    transform 150ms ease,
    background 170ms ease,
    color 170ms ease,
    box-shadow 170ms ease;
}

.source-tooltip {
  font-style: normal;
}

.source-pill span {
  color: color-mix(in srgb, var(--cv-accent-title) 78%, white 22%);
  font-size: 12px;
  font-weight: 950;
  line-height: 1;
}

.source-pill strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 950;
  line-height: 1;
}

.source-pill:hover {
  transform: translateY(-1px);
  background: var(--cv-icon-hover-bg);
  color: var(--cv-icon-hover-color);
  box-shadow:
    0 0 16px color-mix(in srgb, var(--cv-accent-title) 20%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--cv-accent-title) 42%, transparent);
}

.plain-icon {
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 4px;
  background: rgba(0, 11, 18, 0.72);
  color: #ffffff;
  display: flex;
  place-items: center;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 0;
}

.button-tooltip {
  position: absolute;
  left: 50%;
  top: calc(100% + 13px);
  z-index: 5;
  min-width: max-content;
  padding: 11px 17px;
  border-radius: 2px;
  background: rgba(4, 8, 12, 0.92);
  color: rgba(255, 255, 255, 0.96);
  font-size: 13px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.42);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -4px);
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.button-tooltip::before {
  content: "";
  position: absolute;
  left: 50%;
  top: -7px;
  width: 14px;
  height: 14px;
  background: rgba(4, 8, 12, 0.92);
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  transform: translateX(-50%);
}

.plain-icon:hover .button-tooltip,
.icon-button:hover .button-tooltip,
.source-pill:hover .button-tooltip {
  opacity: 1;
  transform: translate(-50%, 0);
}

.quick-tooltip {
  top: calc(100% + 14px);
}

.qr-tooltip {
  display: grid;
  justify-items: center;
  gap: 9px;
  width: 146px;
  padding: 13px 13px 12px;
  font-size: 12px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
}

.quick-qr {
  width: 116px;
  height: 116px;
  display: block;
  object-fit: cover;
  border-radius: 3px;
  background: #fff;
}

.plain-icon > svg {
  display: block;
  transform: none;
  margin: 0;
  width: 18px;
  height: 18px;
}

.plain-icon.close:hover {
  color: #ffffff;
  background: rgba(255, 82, 82, 0.75);
}

.left-stack {
  position: absolute;
  left: 48px;
  top: 108px;
  width: 364px;
  min-width: 364px;
  display: grid;
  gap: 8px;
  transform: scale(0.75);
  transform-origin: top left;
  z-index: 2;
  transition:
    transform 240ms ease,
    opacity 180ms ease;
}

.left-stack.collapsed {
  transform: translateX(-410px) scale(0.75);
  opacity: 0;
  pointer-events: none;
}

.promo-panel,
.profile-panel {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(12, 22, 28, 0.82), rgba(4, 9, 14, 0.86));
  box-shadow: 0 22px 44px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(14px);
}

.promo-panel {
  display: grid;
  grid-template-columns: 72px 1fr;
  height: 286px;
}

.promo-image {
  position: relative;
  aspect-ratio: 2048 / 747;
  width: 100%;
  overflow: hidden;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--cv-download-progress-start) 20%, transparent), transparent),
    rgba(4, 9, 14, 0.56);
}

.promo-panel.video .promo-image {
  aspect-ratio: 16 / 9;
  height: 185px;
}

.promo-image img,
.promo-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.promo-video {
  display: block;
  border: 0;
  background: rgba(4, 9, 14, 0.86);
}

.banner-fade-enter-active,
.banner-fade-leave-active {
  transition: opacity 280ms ease;
}

.banner-fade-enter-from,
.banner-fade-leave-to {
  opacity: 0;
}

.news-content {
  position: relative;
  display: grid;
  min-width: 0;
  overflow: hidden;
}

.news-page {
  grid-area: 1 / 1;
  min-width: 0;
  height: 100%;
}

.news-page-motion-enter-active,
.news-page-motion-leave-active {
  transition:
    opacity 125ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: opacity, transform;
}

.news-page-motion-leave-active {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.news-page-motion-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.news-page-motion-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

.tab-row {
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  padding: 16px 10px 16px 12px;
  border-right: 1px solid color-mix(in srgb, var(--cv-panel-accent) 22%, transparent);
  background: rgba(5, 10, 14, 0.3);
}

.news-tab {
  position: relative;
  display: flex;
  align-items: center;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.64);
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
  text-align: left;
  padding: 0 0 0 11px;
}

.news-tab.active {
  color: var(--cv-panel-accent-strong);
}

.news-tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 3px;
  background: var(--cv-panel-accent);
}

.news-list {
  list-style: none;
  padding: 8px 15px 12px;
  margin: 0;
}

.promo-panel.video .news-list {
  max-height: 101px;
  overflow-y: auto;
}

.promo-panel.video .news-list::-webkit-scrollbar {
  width: 4px;
}

.promo-panel.video .news-list::-webkit-scrollbar-thumb {
  background: var(--cv-panel-accent-soft);
}

.news-list li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
  min-height: 38px;
  border-top: 1px solid color-mix(in srgb, var(--cv-panel-accent) 28%, transparent);
  font-size: 13px;
  font-weight: 850;
  cursor: default;
  transition: color 160ms ease;
}

.news-list li:hover,
.news-list li.active {
  color: var(--cv-panel-accent-strong);
}

.news-list span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.news-list time {
  color: rgba(255, 255, 255, 0.58);
  font-size: 16px;
}

.character-profile {
  padding: 8px 15px 12px;
  color: rgba(255, 255, 255, 0.88);
}

.character-profile h3 {
  margin: 0 0 7px;
  color: var(--cv-panel-accent-strong);
  font-size: 24px;
  font-weight: 950;
  line-height: 1.18;
}

.character-profile p {
  margin: 0 0 14px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 18px;
  font-weight: 800;
}

.character-tags {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
}

.character-tags span {
  min-width: 0;
  padding: 8px 6px;
  border: 1px solid color-mix(in srgb, var(--cv-panel-accent) 34%, transparent);
  background: rgba(255, 255, 255, 0.045);
  color: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  font-weight: 850;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.notice-board {
  height: 170px;
  padding: 8px 15px 12px;
  overflow-y: auto;
  color: rgba(255, 255, 255, 0.78);
  scrollbar-width: thin;
  scrollbar-color: var(--cv-panel-accent-soft) transparent;
}

.notice-board::-webkit-scrollbar {
  width: 4px;
}

.notice-board::-webkit-scrollbar-track {
  background: transparent;
}

.notice-board::-webkit-scrollbar-thumb {
  background: var(--cv-panel-accent-soft);
}

.notice-board header {
  margin-bottom: 8px;
}

.notice-board h3 {
  margin: 0 0 4px;
  color: var(--cv-panel-accent-strong);
  font-size: 19px;
  font-weight: 950;
  line-height: 1.15;
}

.notice-board header p {
  margin: 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 13px;
  font-weight: 800;
}

.notice-section + .notice-section {
  margin-top: 10px;
}

.notice-section h4 {
  margin: 0 0 5px;
  color: var(--cv-panel-accent-strong);
  font-size: 15px;
  font-weight: 950;
}

.notice-section ul {
  display: grid;
  gap: 4px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.notice-section li {
  position: relative;
  padding-left: 10px;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
}

.notice-section li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 4px;
  height: 4px;
  background: var(--cv-panel-accent);
}

.profile-panel {
  padding: 12px 17px 11px;
}

.profile-head {
  display: grid;
  grid-template-columns: 36px 1fr 34px;
  align-items: center;
  gap: 13px;
}

.swap-button,
.sync-button {
  width: 32px;
  height: 32px;
  border-radius: 4px;
}

.profile-head h2 {
  margin: 0;
  font-size: 19px;
}

.profile-head p {
  margin: 5px 0 0;
  color: var(--cv-download-progress-end);
  font-weight: 800;
  white-space: nowrap;
}

.resource-grid {
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 11px 22px;
}

.resource-item {
  display: grid;
  grid-template-columns: 34px max-content minmax(42px, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 0;
  min-width: 0;
}

.resource-item span {
  grid-row: 1 / 3;
  width: 27px;
  height: 27px;
  border-radius: 7px;
  transform: rotate(45deg);
  box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.5), 0 0 18px currentColor;
}

.resource-item strong {
  font-size: 18px;
  color: var(--cv-download-progress-end);
  line-height: 1;
}

.resource-item small {
  align-self: end;
  margin-left: 6px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

.resource-item em {
  grid-column: 2 / 4;
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.65);
  font-style: normal;
  font-size: 12px;
  line-height: 1.15;
  white-space: nowrap;
}

.cyan {
  color: #4ed7df;
}

.green {
  color: #49e883;
}

.amber {
  color: #f5bf45;
}

.slate {
  color: #adb7c7;
}

.gem {
  background: linear-gradient(135deg, currentColor, #ffffff);
}

.coin,
.disc {
  border-radius: 50% !important;
  background: radial-gradient(circle, #fff6c2, currentColor 55%, #65440b);
}

.disc {
  background: radial-gradient(circle, #e6ebf3, #2b3445 56%, #080b10);
}

.profile-note {
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 12px;
  line-height: 1.2;
}

.right-launcher {
  position: absolute;
  right: 236px;
  bottom: 150px;
  width: 300px;
  height: 250px;
  z-index: 2;
}

.hero-copy {
  position: absolute;
  right: 0;
  bottom: 94px;
  width: 430px;
  text-align: right;
  text-shadow: 0 6px 28px rgba(0, 0, 0, 0.72);
  transition: transform 180ms ease;
}

.hero-copy.raised {
  transform: translateY(-42px);
}

.hero-copy h2 {
  margin: 0;
  display: inline-block;
  font-family: "SJBangshu", serif;
  font-size: 42px;
  line-height: 0.92;
  font-weight: 500;
  color: var(--cv-accent-title);
  text-shadow:
    0 4px 16px rgba(0, 0, 0, 0.5);
  filter: drop-shadow(0 1px 0 rgba(96, 61, 22, 0.22));
  letter-spacing: 0;
  white-space: normal;
}

.collab-line {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  color: color-mix(in srgb, var(--cv-accent-title) 80%, transparent);
  font-family: "UnispaceCV", sans-serif;
  font-size: 11.5px;
  font-weight: 700;
}

.collab-line i {
  width: 44px;
  height: 3px;
  background: currentColor;
  transform: skewX(-25deg);
}

.download-dock {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 310px;
  min-width: 310px;
}

.download-state {
  min-width: 0;
  overflow: hidden;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 950;
  text-shadow: 0 3px 12px rgba(0, 0, 0, 0.6);
  white-space: nowrap;
}

.download-state > span {
  min-width: 0;
  overflow: hidden;
  margin-right: auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.verification-detail {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: -3px 0 6px;
  color: rgba(255, 255, 255, 0.76);
  font-family: "UnispaceCV", "Microsoft YaHei UI", sans-serif;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.verification-detail strong {
  overflow: hidden;
  color: #ffb9ad;
  text-overflow: ellipsis;
}

.download-state.compact {
  justify-content: flex-end;
  gap: 0;
  margin-bottom: -4px;
}

.download-progress-block {
  min-height: 34px;
}

.download-progress-block.warning .download-state {
  color: #ffe6e1;
}


.check-result-line {
  min-width: 310px;
  margin-top: 12px;
  margin-bottom: -4px;
  color: var(--cv-download-progress-end);
  font-size: 12px;
  font-weight: 900;
  text-align: right;
  text-shadow: 0 3px 12px rgba(0, 0, 0, 0.65);
  white-space: nowrap;
}

.download-progress-fade-enter-active,
.download-progress-fade-leave-active {
  transition:
    opacity 160ms ease,
    transform 180ms ease,
    max-height 180ms ease;
}

.download-progress-fade-enter-from,
.download-progress-fade-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(6px);
}

.download-state b {
  color: var(--cv-accent-title);
}

.download-progress-block.warning .download-state b,
.download-progress-block.warning .repair-missing-detail {
  color: #ff756f;
}

.download-size {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}

.download-size.install-detail {
  min-width: 0;
  max-width: 160px;
  flex: 1 1 auto;
  justify-content: flex-end;
  overflow: hidden;
}

.download-size.install-detail span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-state > b {
  flex: 0 0 auto;
}

.download-time {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;
}

.download-size em {
  font-style: normal;
}

.download-state strong,
.download-state b {
  font-family: "UnispaceCV", "Microsoft YaHei UI", sans-serif;
  font-weight: 700;
  letter-spacing: 0;
}

.progress-track {
  height: 11px;
  padding: 2px;
  border: 1px solid var(--cv-download-progress-border);
  border-radius: 999px;
  background: rgba(5, 10, 15, 0.66);
  box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.9);
}

.progress-fill {
  position: relative;
  overflow: hidden;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--cv-download-progress-start), var(--cv-download-progress-end));
  box-shadow: 0 0 18px var(--cv-download-progress-glow);
  transition: width 250ms ease;
}

.progress-fill.warning {
  background: linear-gradient(90deg, #9e4546, #ff756f);
  box-shadow: 0 0 18px rgba(255, 91, 88, 0.64);
}

.progress-fill::after {
  content: "";
  position: absolute;
  top: -55%;
  bottom: -55%;
  left: -52%;
  width: 42%;
  transform: skewX(-24deg);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, white 18%, transparent),
    color-mix(in srgb, white 54%, transparent),
    color-mix(in srgb, var(--cv-download-progress-end) 26%, transparent),
    transparent
  );
  opacity: 0;
  pointer-events: none;
}

.progress-fill.active::after {
  opacity: 0.78;
  animation: progress-sheen 1.35s linear infinite;
}

@keyframes progress-sheen {
  from {
    left: -52%;
  }

  to {
    left: 116%;
  }
}

.dock-actions {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 59px 189px;
  gap: 12px;
  align-items: end;
  justify-content: end;
}

.menu-button {
  width: 59px;
  height: 59px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
}

.primary-action {
  width: 189px;
  height: 59px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border: 0;
  border-radius: 5px;
  color: #26344a;
  background:
    linear-gradient(90deg, rgba(255, 238, 132, 0.28), rgba(255, 246, 183, 0.18)),
    url("/launcher/practical/Setting_10.PNG") center / cover no-repeat;
  font-size: 16px;
  font-weight: 950;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 30px rgba(0, 0, 0, 0.34), inset 0 0 0 1px rgba(33, 58, 87, 0.45);
  transition:
    transform 160ms ease,
    filter 160ms ease;
}

.primary-action:hover {
  transform: translateY(-2px);
  filter: brightness(1.08);
}

.primary-action.warning {
  color: #ffe9e5;
  background:
    linear-gradient(90deg, rgba(142, 64, 66, 0.72), rgba(219, 95, 88, 0.54)),
    url("/launcher/practical/Setting_10.PNG") center / cover no-repeat;
  text-shadow: 0 2px 8px rgba(35, 6, 7, 0.54);
  box-shadow: 0 18px 30px rgba(0, 0, 0, 0.34), inset 0 0 0 1px rgba(255, 142, 132, 0.42);
}

.primary-action.warning:hover {
  filter: brightness(1.12);
}

.primary-action:disabled,
.primary-action.disabled {
  cursor: wait;
  opacity: 0.58;
  filter: grayscale(0.2) brightness(0.86);
  transform: none;
}

.primary-action:disabled:hover,
.primary-action.disabled:hover {
  transform: none;
  filter: grayscale(0.2) brightness(0.86);
}

.menu-button:disabled,
.menu-button.disabled {
  cursor: wait;
  opacity: 0.5;
  filter: grayscale(0.25) brightness(0.82);
  transform: none;
}

.menu-button:disabled:hover,
.menu-button.disabled:hover {
  color: rgba(255, 255, 255, 0.88);
  background: rgba(0, 11, 18, 0.62);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
  transform: none;
}

.spinning {
  animation: icon-spin 980ms linear infinite;
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-menu {
  position: absolute;
  right: 201px;
  bottom: 76px;
  width: 240px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(8, 14, 20, 0.92);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
  transform-origin: bottom right;
  will-change: opacity, transform;
}

.tool-menu-pop-enter-active,
.tool-menu-pop-leave-active {
  transition:
    opacity 140ms ease,
    transform 160ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.tool-menu-pop-enter-from,
.tool-menu-pop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.tool-menu button {
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  font-weight: 800;
}

.tool-menu button:hover {
  background: var(--cv-icon-hover-bg);
  color: var(--cv-icon-hover-color);
}

.tool-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  color: rgba(255, 255, 255, 0.42);
  background: rgba(35, 35, 35, 0.28);
}

.tool-menu button:disabled:hover {
  color: rgba(255, 255, 255, 0.42);
  background: rgba(35, 35, 35, 0.28);
}

.tool-menu .tool-menu-toggle {
  margin-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
}

.menu-check {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--cv-download-progress-end) 38%, rgba(255, 255, 255, 0.18));
  background: rgba(255, 255, 255, 0.04);
  color: var(--cv-download-progress-end);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.tool-menu-toggle.active .menu-check {
  border-color: color-mix(in srgb, var(--cv-download-progress-end) 72%, transparent);
  background: color-mix(in srgb, var(--cv-download-progress-end) 18%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--cv-download-progress-end) 28%, transparent);
}

.side-handle {
  position: absolute;
  left: 0;
  bottom: 330px;
  width: 52px;
  height: 78px;
  border: 0;
  display: grid;
  place-items: center;
  border-radius: 0 6px 6px 0;
  background: rgba(2, 10, 15, 0.68);
  color: var(--cv-download-progress-start);
  z-index: 2;
  transition:
    transform 180ms ease,
    background 180ms ease;
}

.side-handle svg {
  transform: rotate(0deg);
  transition: transform 180ms ease;
}

.side-handle.collapsed svg {
  transform: rotate(180deg);
}

.side-handle:hover {
  background: color-mix(in srgb, var(--cv-download-progress-start) 16%, transparent);
}

.version-corner {
  position: absolute;
  left: 71px;
  bottom: 140px;
  z-index: 3;
  display: grid;
  gap: 4px;
  color: color-mix(in srgb, var(--cv-download-progress-end) 72%, rgba(255, 255, 255, 0.72));
  font-family: "UnispaceCV", "Microsoft YaHei UI", sans-serif;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.1;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.72);
  opacity: 0.78;
  pointer-events: none;
}

.install-mask {
  position: absolute;
  inset: 0;
  z-index: 210;
  display: grid;
  place-items: center;
  background: rgba(2, 7, 12, 0.42);
  backdrop-filter: blur(3px);
  -webkit-app-region: no-drag;
}

.install-panel {
  position: relative;
  width: 750px;
  min-height: 310px;
  padding: 40px 40px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  background: rgba(29, 33, 38, 0.96);
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 30px 82px rgba(0, 0, 0, 0.42);
  transform: translate(-80px, -36px) scale(0.6);
  transform-origin: center center;
}

.install-close {
  position: absolute;
  right: 14px;
  top: 13px;
  width: 32px;
  height: 32px;
  border: 0;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.76);
  background: transparent;
}

.install-close:hover {
  color: #fff;
}

.install-panel h2 {
  margin: 0 0 28px;
  color: #fff;
  font-size: 24px;
  font-weight: 950;
}

.install-path-row {
  width: 670px;
  height: 58px;
  padding: 0 24px 0 28px;
  border-radius: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 58px;
  align-items: center;
  gap: 18px;
  background: rgba(255, 255, 255, 0.06);
}

.install-path-row span {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.96);
  font-size: 22px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-path-row button {
  border: 0;
  color: var(--cv-download-progress-start);
  background: transparent;
  font-size: 20px;
  font-weight: 900;
}

.install-space-row {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 20px;
  color: rgba(255, 255, 255, 0.56);
  font-size: 18px;
  font-weight: 700;
}

.install-space-row i {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.32);
}

.install-space-row .danger {
  color: #ff706a;
}

.dev-package-panel {
  min-height: 300px;
}

.dev-package-panel .install-continue {
  bottom: 30px;
}

.dev-package-note {
  margin: 10px 0 0 2px;
  color: rgba(255, 255, 255, 0.56);
  font-size: 17px;
  font-weight: 700;
}

.install-option {
  margin-top: 10px;
  min-height: 30px;
  border: 0;
  display: inline-grid;
  grid-template-columns: 24px auto;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.9);
  background: transparent;
  transition: color 160ms ease;
}

.install-option:hover {
  color: var(--cv-check-accent);
}

.install-option strong {
  font-size: 18px;
  font-weight: 700;
}

.install-option .check-box {
  width: 21px;
  height: 21px;
}

.install-continue {
  position: absolute;
  right: 38px;
  bottom: 40px;
  width: 150px;
  height: 54px;
  border: 0;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(13, 16, 18, 0.96);
  background: linear-gradient(90deg, var(--cv-panel-accent-strong), var(--cv-panel-accent));
  font-size: 20px;
  font-weight: 950;
  transition:
    color 170ms ease,
    background 170ms ease,
    box-shadow 170ms ease,
    filter 170ms ease;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--cv-panel-accent-strong) 64%, transparent),
    0 10px 24px rgba(0, 0, 0, 0.24);
}

.install-continue:hover {
  color: color-mix(in srgb, var(--cv-theme-accent) 48%, white 52%);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--cv-theme-support) 84%, var(--cv-theme-accent) 16%) 0%,
      color-mix(in srgb, var(--cv-theme-support) 90%, var(--cv-theme-accent) 10%) 100%
    );
  box-shadow:
    0 0 16px color-mix(in srgb, var(--cv-theme-accent) 18%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--cv-theme-accent) 42%, transparent);
  filter: brightness(1.02);
}

.install-pop-enter-active,
.install-pop-leave-active {
  transition:
    opacity 160ms ease,
    backdrop-filter 180ms ease;
}

.install-pop-enter-active .install-panel,
.install-pop-leave-active .install-panel {
  transition:
    opacity 170ms ease,
    transform 190ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.install-pop-enter-from,
.install-pop-leave-to {
  opacity: 0;
  backdrop-filter: blur(0);
}

.install-pop-enter-from .install-panel,
.install-pop-leave-to .install-panel {
  opacity: 0;
  transform: translate(-80px, -26px) scale(0.58);
}

.modal-mask {
  position: absolute;
  inset: 0;
  display: block;
  padding: 0;
  app-region: no-drag;
  -webkit-app-region: no-drag;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--cv-bg-surface) 18%, transparent),
      color-mix(in srgb, var(--cv-theme-accent) 10%, transparent),
      color-mix(in srgb, var(--cv-bg-surface-cool) 20%, transparent)
    ),
    color-mix(in srgb, var(--cv-bg-deep) 24%, transparent);
  backdrop-filter: blur(10px);
  z-index: 120;
}

.settings-mask {
  backdrop-filter: blur(3px);
}

.settings-layer-enter-active,
.settings-layer-leave-active {
  transition: opacity 100ms ease;
}

.settings-layer-enter-active .settings-modal,
.settings-layer-leave-active .settings-modal,
.settings-layer-enter-active .settings-close,
.settings-layer-leave-active .settings-close,
.settings-layer-enter-active .settings-scrollbar-rail,
.settings-layer-leave-active .settings-scrollbar-rail {
  transition:
    opacity 110ms ease,
    transform 120ms ease-out;
}

.settings-layer-enter-from,
.settings-layer-leave-to {
  opacity: 0;
}

.settings-layer-enter-from .settings-modal,
.settings-layer-leave-to .settings-modal {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.settings-layer-enter-from .settings-close,
.settings-layer-leave-to .settings-close,
.settings-layer-enter-from .settings-scrollbar-rail,
.settings-layer-leave-to .settings-scrollbar-rail {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

.settings-modal {
  position: relative;
  z-index: 10;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  app-region: no-drag;
  -webkit-app-region: no-drag;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cv-accent-soft) 18%, transparent);
  border-radius: 0;
  background:
    radial-gradient(circle at 1% 17%, color-mix(in srgb, var(--cv-theme-accent) 18%, transparent), transparent 24%),
    radial-gradient(circle at 91% 2%, color-mix(in srgb, var(--cv-accent-muted) 15%, transparent), transparent 20%),
    linear-gradient(
      108deg,
      color-mix(in srgb, var(--cv-bg-surface) 78%, transparent),
      color-mix(in srgb, var(--cv-bg-surface-soft) 62%, transparent) 48%,
      color-mix(in srgb, var(--cv-bg-surface-cool) 78%, transparent)
    ),
    color-mix(in srgb, var(--cv-bg-deep) 88%, transparent);
  box-shadow: 0 20px 66px rgba(0, 0, 0, 0.5);
  backdrop-filter: none;
}

.settings-modal::before,
.settings-modal::after {
  content: "";
  position: absolute;
  pointer-events: none;
  opacity: 0.34;
}

.settings-modal::before {
  left: -360px;
  top: -126px;
  width: 430px;
  height: 330px;
  border: 1px solid color-mix(in srgb, var(--cv-theme-accent) 34%, transparent);
  border-radius: 50%;
  transform: rotate(16deg);
}

.settings-modal::after {
  right: -40px;
  bottom: -18px;
  width: 330px;
  height: 136px;
  background:
    repeating-linear-gradient(168deg, color-mix(in srgb, var(--cv-accent-soft) 22%, transparent) 0 1px, transparent 1px 9px);
  mask-image: linear-gradient(90deg, transparent, #000 25%, #000 84%, transparent);
}

.settings-sidebar {
  position: relative;
  z-index: 1;
  padding: 44px 28px 38px 28px;
  app-region: no-drag;
  -webkit-app-region: no-drag;
  border-right: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
}

.settings-tab {
  position: relative;
  width: 165px;
  height: 42px;
  margin-bottom: 13px;
  padding: 0 13px;
  display: grid;
  grid-template-columns: 21px 1fr;
  align-items: center;
  gap: 11px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  font-weight: 950;
  text-align: left;
}

.settings-tab svg {
  color: rgba(255, 255, 255, 0.72);
}

.settings-tab.active {
  border-color: color-mix(in srgb, var(--cv-accent-soft) 42%, transparent);
  color: var(--cv-accent-soft);
  background:
    radial-gradient(circle at 96% 50%, color-mix(in srgb, var(--cv-theme-accent) 22%, transparent), transparent 18%),
    linear-gradient(
      90deg,
      color-mix(in srgb, white 8%, transparent),
      color-mix(in srgb, var(--cv-theme-support) 12%, transparent)
    );
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.settings-tab.active svg {
  color: rgba(255, 255, 255, 0.92);
}

.settings-tab:disabled,
.settings-tab.disabled {
  cursor: not-allowed;
  opacity: 0.42;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(20, 24, 24, 0.22);
}

.settings-tab:disabled svg,
.settings-tab.disabled svg {
  color: rgba(255, 255, 255, 0.42);
}

.settings-tab.active::after {
  content: "";
  position: absolute;
  right: 6px;
  top: 5px;
  width: 51px;
  height: 30px;
  opacity: 0.46;
  background:
    radial-gradient(circle at 78% 58%, var(--cv-accent-muted) 0 3px, transparent 4px),
    repeating-linear-gradient(
      145deg,
      transparent 0 9px,
      color-mix(in srgb, var(--cv-theme-accent) 32%, transparent) 10px 11px
    );
  mask-image: linear-gradient(90deg, transparent, #000);
}

.settings-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  overflow: hidden;
  padding: 0 118px 38px 42px;
  display: grid;
  grid-template-rows: 100px 24px 1fr;
  app-region: no-drag;
  -webkit-app-region: no-drag;
}

.settings-header {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 38px;
  justify-content: space-between;
  app-region: no-drag;
  -webkit-app-region: no-drag;
}

.settings-title-stage {
  min-width: 0;
  display: grid;
}

.settings-title-stage > h2 {
  grid-area: 1 / 1;
}

.settings-title-motion-enter-active,
.settings-title-motion-leave-active {
  transition:
    opacity 90ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 105ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: opacity, transform;
}

.settings-title-motion-leave-active {
  pointer-events: none;
}

.settings-title-motion-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.settings-title-motion-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

.settings-modal h2 {
  margin: 0;
  color: var(--cv-accent-title);
  font-size: 23px;
  font-weight: 950;
}


.settings-close {
  position: absolute;
  right: 250px;
  top: 24px;
  width: 54px;
  height: 54px;
  border: 0;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  z-index: 160;
  app-region: no-drag;
  -webkit-app-region: no-drag;
}

.settings-close:hover {
  color: var(--cv-icon-hover-color);
  background: var(--cv-icon-hover-bg);
}

.settings-close svg {
  display: block;
  filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.12));
}

.settings-scrollbar-rail {
  position: absolute;
  right: 266px;
  width: 8px;
  z-index: 150;
  opacity: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cv-accent-title) 32%, transparent);
  app-region: no-drag;
  -webkit-app-region: no-drag;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.settings-scrollbar-rail.visible {
  opacity: 1;
}

.settings-scrollbar-rail span {
  display: block;
  width: 100%;
  height: 72%;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    var(--cv-accent-title),
    color-mix(in srgb, var(--cv-accent-title) 74%, var(--cv-theme-support) 26%)
  );
  box-shadow: 0 0 14px color-mix(in srgb, var(--cv-accent-title) 28%, transparent);
}

.settings-divider {
  position: relative;
  height: 2px;
  margin-left: -42px;
  app-region: no-drag;
  -webkit-app-region: no-drag;
  background: rgba(255, 255, 255, 0.34);
}

.settings-divider::before {
  content: "";
  position: absolute;
  left: -84px;
  top: -15px;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 50%;
  background:
    linear-gradient(90deg, transparent 49%, rgba(255, 255, 255, 0.78) 50%, transparent 51%),
    linear-gradient(0deg, transparent 49%, rgba(255, 255, 255, 0.78) 50%, transparent 51%);
}

.settings-scroll {
  position: relative;
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 18px 44px 10px 0;
  scrollbar-width: none;
}

.settings-scroll::-webkit-scrollbar {
  display: none;
}

.settings-scroll-spacer {
  width: 1px;
  pointer-events: none;
}

.settings-scroll-frame {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: visible;
}

.settings-page-stage {
  position: relative;
  min-width: 0;
}

.settings-page {
  width: min(620px, 100%);
  zoom: 0.96;
}

.settings-page-motion-enter-active,
.settings-page-motion-leave-active {
  transition:
    opacity 125ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: opacity, transform;
}

.settings-page-motion-leave-active {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}

.settings-page-motion-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.settings-page-motion-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

.settings-page::after {
  content: "";
  display: block;
  height: 1px;
}

.setting-block {
  margin: 0 0 24px;
  display: grid;
  gap: 14px;
}

.setting-title {
  color: rgba(255, 255, 255, 0.92);
  font-size: 22px;
  font-weight: 950;
}

.setting-hint {
  margin: -5px 0 0;
  color: rgba(228, 224, 214, 0.56);
  font-size: 13px;
  line-height: 1.45;
}

.traffic-quota__notice {
  margin: -4px 0 -4px;
  color: rgba(228, 224, 214, 0.58);
  font-size: 12px;
  line-height: 1.45;
}

.traffic-quota__notice.low {
  color: #ffb9ad;
  font-weight: 800;
}

.traffic-quota {
  width: 100%;
  max-width: 470px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--cv-accent-soft) 28%, transparent);
  border-radius: 5px;
  display: grid;
  gap: 8px;
  background: rgba(3, 10, 14, 0.44);
  color: rgba(255, 255, 255, 0.72);
}

.traffic-quota__header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  font-size: 12px;
}

.traffic-quota__header span {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--cv-accent-title) 78%, white 22%);
  font-weight: 950;
}

.traffic-quota__header strong {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.88);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-quota__track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}

.traffic-quota__track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--cv-accent-title);
  transition: width 240ms ease;
}

.traffic-quota small {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}

.traffic-quota.low {
  border-color: rgba(255, 121, 105, 0.48);
  background: rgba(53, 14, 14, 0.48);
}

.traffic-quota.low .traffic-quota__header span,
.traffic-quota.low .traffic-quota__header strong,
.traffic-quota.low small {
  color: #ffb9ad;
}

.traffic-quota.low .traffic-quota__track span {
  background: #ff756f;
}

.traffic-quota.unavailable {
  opacity: 0.72;
}

.path-input {
  width: 100%;
  max-width: 470px;
  height: 52px;
  border: 1px solid var(--cv-form-border);
  border-radius: 5px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--cv-accent-soft) 8%, transparent),
      color-mix(in srgb, var(--cv-bg-deep) 18%, transparent)
    ),
    color-mix(in srgb, var(--cv-theme-support) 76%, transparent);
  color: rgba(255, 255, 255, 0.92);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 10px 24px rgba(0, 0, 0, 0.22);
}

.path-input {
  max-width: 520px;
  padding: 0 18px;
  color: rgba(255, 255, 255, 0.92);
  font-size: 18px;
  font-weight: 900;
}

.path-input:focus,
.path-input:focus-visible {
  outline: none;
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.72),
    0 0 0 1px color-mix(in srgb, var(--cv-form-border-strong) 62%, transparent),
    0 10px 24px rgba(0, 0, 0, 0.22);
}

.developer-version-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 168px;
  gap: 12px;
  align-items: center;
  max-width: 700px;
}

.developer-version-row .path-input {
  max-width: none;
}

.developer-game-publish-block {
  max-width: 700px;
}

.developer-game-metadata,
.developer-game-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.developer-game-metadata label {
  min-width: 0;
  display: grid;
  gap: 8px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
  font-weight: 900;
}

.developer-game-metadata .path-input,
.developer-game-actions .light-action {
  width: 100%;
  max-width: none;
}

.developer-game-actions .test-server-action {
  color: #5f5232;
  background: linear-gradient(180deg, #fff5d8, #e8d39b);
  box-shadow: inset 0 0 0 1px rgba(125, 99, 40, 0.18);
}

.developer-notice-block {
  max-width: 700px;
}

.developer-notice-title {
  width: 100%;
  max-width: none;
  height: 50px;
  margin-top: 12px;
  border: 1px solid color-mix(in srgb, var(--cv-theme-accent) 32%, rgba(255, 255, 255, 0.2));
  border-radius: 4px;
  background: color-mix(in srgb, var(--cv-theme-support) 82%, transparent);
}

.developer-notice-content {
  width: 100%;
  min-height: 138px;
  margin-top: 12px;
  padding: 14px 18px;
  resize: vertical;
  border: 1px solid color-mix(in srgb, var(--cv-theme-accent) 32%, rgba(255, 255, 255, 0.2));
  border-radius: 4px;
  outline: none;
  background: color-mix(in srgb, var(--cv-theme-support) 82%, transparent);
  color: rgba(255, 255, 255, 0.92);
  font: 850 17px/1.65 "Microsoft YaHei", sans-serif;
}

.developer-notice-content:focus {
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.62);
}

.developer-notice-levels {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.developer-notice-levels button {
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.68);
  font-size: 16px;
  font-weight: 950;
}

.developer-notice-levels button.active.info {
  border-color: #9ba5ae;
  background: rgba(155, 165, 174, 0.2);
  color: #eef2f5;
}

.developer-notice-levels button.active.warning {
  border-color: #d8b04f;
  background: rgba(216, 176, 79, 0.2);
  color: #ffe59c;
}

.developer-notice-levels button.active.error {
  border-color: #c95e5e;
  background: rgba(201, 94, 94, 0.22);
  color: #ffc1b8;
}

.developer-notice-actions {
  display: grid;
  grid-template-columns: repeat(2, 196px);
  gap: 12px;
  margin-top: 14px;
}

.developer-notice-disable {
  color: #ffe8e2;
  background: linear-gradient(90deg, rgba(142, 79, 70, 0.94), rgba(104, 59, 55, 0.92));
}

.remote-notice-mask {
  position: fixed;
  inset: 0;
  z-index: 260;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgba(2, 5, 8, 0.74);
  backdrop-filter: blur(5px);
}

.remote-notice-panel {
  width: min(650px, calc(100vw - 64px));
  max-height: min(520px, calc(100vh - 64px));
  overflow: hidden;
  padding: 28px;
  border: 1px solid rgba(155, 165, 174, 0.62);
  border-radius: 6px;
  background: color-mix(in srgb, var(--cv-theme-support) 94%, #101820 6%);
  box-shadow: 0 26px 72px rgba(0, 0, 0, 0.54);
}

.remote-notice-panel.warning {
  border-color: rgba(216, 176, 79, 0.78);
}

.remote-notice-panel.error {
  border-color: rgba(201, 94, 94, 0.82);
}

.remote-notice-panel header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.remote-notice-panel header > svg {
  flex: 0 0 auto;
  color: #9ba5ae;
}

.remote-notice-panel.warning header > svg {
  color: #e2b94f;
}

.remote-notice-panel.error header > svg {
  color: #dc6d67;
}

.remote-notice-panel header span {
  color: rgba(255, 255, 255, 0.52);
  font-size: 14px;
  font-weight: 900;
}

.remote-notice-panel h2 {
  margin: 3px 0 0;
  color: rgba(255, 255, 255, 0.96);
  font-size: 27px;
  line-height: 1.25;
}

.remote-notice-panel > p {
  max-height: 290px;
  overflow-y: auto;
  margin: 22px 0;
  padding-right: 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: rgba(255, 255, 255, 0.82);
  font-size: 18px;
  font-weight: 750;
  line-height: 1.75;
}

.remote-notice-panel > button {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: 4px;
  background: rgba(238, 236, 229, 0.96);
  color: rgba(58, 55, 50, 0.95);
  font-size: 17px;
  font-weight: 950;
}

.check-row,
.radio-row {
  width: fit-content;
  min-height: 40px;
  padding: 0;
  border: 0;
  display: grid;
  grid-template-columns: 36px auto;
  align-items: center;
  gap: 13px;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font-size: 19px;
  font-weight: 950;
  transition: color 160ms ease;
}

.check-row:hover {
  color: var(--cv-check-accent);
}

.check-box {
  width: 29px;
  height: 29px;
  display: grid;
  place-items: center;
  border: 3px solid color-mix(in srgb, var(--cv-check-accent) 34%, rgba(255, 255, 255, 0.5));
  border-radius: 5px;
  color: #fff;
  background: color-mix(in srgb, var(--cv-theme-support) 72%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, white 8%, transparent);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    transform 160ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.check-box svg {
  opacity: 0;
  transform: scale(0.58) rotate(-10deg);
  transition:
    opacity 130ms ease,
    transform 170ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.check-row.checked .check-box,
.install-option.checked .check-box {
  border-color: var(--cv-check-accent);
  color: #fff;
  background: linear-gradient(135deg, var(--cv-check-accent), var(--cv-check-accent-dark));
  box-shadow:
    0 0 0 3px var(--cv-check-accent-glow),
    inset 0 0 0 1px color-mix(in srgb, white 22%, transparent);
  transform: scale(1.04);
}

.check-row.checked .check-box svg,
.install-option.checked .check-box svg {
  opacity: 1;
  transform: scale(1) rotate(0deg);
}

.radio-dot {
  position: relative;
  width: 29px;
  height: 29px;
  border: 3px solid color-mix(in srgb, var(--cv-check-accent) 34%, rgba(255, 255, 255, 0.5));
  border-radius: 50%;
  background: color-mix(in srgb, var(--cv-theme-support) 72%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, white 8%, transparent);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    transform 160ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.radio-row.checked .radio-dot {
  border-color: var(--cv-check-accent);
  background: color-mix(in srgb, var(--cv-check-accent-dark) 42%, var(--cv-theme-support) 58%);
  box-shadow:
    0 0 0 3px var(--cv-check-accent-glow),
    inset 0 0 0 1px color-mix(in srgb, white 18%, transparent);
  transform: scale(1.04);
}

.radio-dot::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 6px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--cv-check-accent);
  box-shadow: 0 0 0 3px var(--cv-check-accent-glow);
  opacity: 0;
  transform: scale(0.45);
  transition:
    opacity 130ms ease,
    transform 170ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.radio-row.checked .radio-dot::after {
  opacity: 1;
  transform: scale(1);
}

.limit-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.speed-input {
  width: 112px;
  height: 38px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  background: rgba(18, 22, 28, 0.62);
  color: rgba(255, 255, 255, 0.92);
  text-align: center;
  font-size: 18px;
  font-weight: 950;
}

.speed-unit {
  color: rgba(255, 255, 255, 0.88);
  font-size: 19px;
  font-weight: 950;
}

.setting-line {
  max-width: 620px;
  min-height: 68px;
  display: grid;
  grid-template-columns: 1fr 68px;
  align-items: center;
  gap: 20px;
}

.setting-line strong,
.about-line {
  display: block;
  color: rgba(255, 255, 255, 0.9);
  font-size: 19px;
  font-weight: 950;
}

.setting-line p {
  margin: 6px 0 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 16px;
  font-weight: 850;
}

.game-actions {
  margin: -6px 0 24px;
  display: grid;
  width: 196px;
  gap: 16px;
}

.game-actions button,
.light-action {
  position: relative;
  overflow: hidden;
  width: 196px;
  height: 50px;
  border: 0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(232, 230, 224, 0.94));
  color: rgba(82, 78, 70, 0.92);
  font-size: 17px;
  font-weight: 950;
  transition:
    color 150ms ease,
    background 170ms ease,
    box-shadow 170ms ease,
    filter 170ms ease;
}

.game-actions button:hover,
.light-action:hover {
  color: color-mix(in srgb, var(--cv-theme-accent) 48%, white 52%);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--cv-theme-support) 84%, var(--cv-theme-accent) 16%) 0%,
      color-mix(in srgb, var(--cv-theme-support) 90%, var(--cv-theme-accent) 10%) 100%
    );
  box-shadow:
    0 0 16px color-mix(in srgb, var(--cv-theme-accent) 18%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--cv-theme-accent) 42%, transparent);
  filter: brightness(1.02);
}

.game-actions .danger-action {
  color: #ffe8e2;
  background:
    linear-gradient(90deg, rgba(142, 79, 70, 0.94), rgba(104, 59, 55, 0.92)),
    rgba(65, 40, 38, 0.94);
  box-shadow: inset 0 0 0 1px rgba(255, 220, 207, 0.16);
  transition:
    color 150ms ease,
    background 170ms ease,
    box-shadow 170ms ease,
    filter 170ms ease;
}

.game-actions .danger-action:hover {
  color: #fff5ef;
  background:
    linear-gradient(90deg, rgba(165, 94, 82, 0.98), rgba(126, 71, 65, 0.96)),
    rgba(74, 43, 40, 0.96);
  box-shadow:
    0 0 16px rgba(142, 79, 70, 0.2),
    inset 0 0 0 1px rgba(255, 225, 216, 0.2);
  filter: brightness(1.03);
}

.game-actions .danger-action-muted {
  color: #f7e7e2;
  background:
    linear-gradient(90deg, rgba(112, 75, 72, 0.94), rgba(78, 59, 58, 0.92)),
    rgba(53, 43, 43, 0.94);
}

.game-actions .danger-action-muted:hover {
  color: #fff5ef;
  background:
    linear-gradient(90deg, rgba(136, 86, 80, 0.98), rgba(96, 68, 65, 0.96)),
    rgba(62, 48, 47, 0.96);
}

.confirm-mask {
  position: absolute;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  background: rgba(4, 7, 10, 0.28);
  backdrop-filter: blur(5px);
  app-region: no-drag;
  -webkit-app-region: no-drag;
}

.confirm-panel {
  width: 564px;
  min-height: 252px;
  padding: 52px 70px 42px;
  border: 0;
  border-radius: 2px;
  transform: translate(-100px, -50px);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
    url("/launcher/practical/22TiShiKuang_Cropped_120.PNG") center / 100% 100% no-repeat;
  box-shadow: 0 24px 76px rgba(0, 0, 0, 0.34);
}

.confirm-panel h3 {
  margin: 0 0 14px;
  color: #30353b;
  font-size: 24.2px;
  font-weight: 950;
}

.confirm-panel p {
  margin: 0 0 28px;
  color: rgba(48, 53, 59, 0.72);
  font-size: 16.5px;
  font-weight: 800;
  line-height: 1.65;
}

.confirm-actions {
  display: grid;
  grid-template-columns: 196px 196px;
  justify-content: center;
  gap: 34px;
}

.confirm-actions button {
  height: 42px;
  border: 0;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 950;
}

.confirm-delete {
  color: #fff7f3;
  background: linear-gradient(90deg, #9f5d53, #7d4944);
}

.confirm-cancel {
  color: rgba(43, 44, 42, 0.94);
  background: rgba(244, 243, 240, 0.94);
}

.confirm-delete:hover {
  background: linear-gradient(90deg, #b16b61, #8f554f);
}

.confirm-cancel:hover {
  background: #f3d789;
}

.confirm-pop-enter-active,
.confirm-pop-leave-active {
  transition:
    opacity 140ms ease,
    backdrop-filter 160ms ease;
}

.confirm-pop-enter-active .confirm-panel,
.confirm-pop-leave-active .confirm-panel {
  transition:
    opacity 150ms ease,
    transform 170ms cubic-bezier(0.2, 0.86, 0.22, 1);
}

.confirm-pop-enter-from,
.confirm-pop-leave-to {
  opacity: 0;
  backdrop-filter: blur(2px);
}

.confirm-pop-enter-from .confirm-panel,
.confirm-pop-leave-to .confirm-panel {
  opacity: 0;
  transform: translate(-100px, -42px) scale(0.97);
}

.settings-page a {
  width: fit-content;
  color: var(--cv-accent-title);
  text-decoration: none;
  font-size: 19px;
  font-weight: 950;
}

.about-line {
  margin: 0;
}

.switch {
  width: 54px;
  height: 28px;
  padding: 3px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.switch span {
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  transition: transform 160ms ease;
}

.switch.on {
  background: linear-gradient(90deg, var(--cv-download-progress-start), var(--cv-download-progress-end));
}

.switch.on span {
  transform: translateX(26px);
}

@media (prefers-reduced-motion: reduce) {
  .news-page-motion-enter-active,
  .news-page-motion-leave-active,
  .settings-title-motion-enter-active,
  .settings-title-motion-leave-active,
  .settings-page-motion-enter-active,
  .settings-page-motion-leave-active {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
  }
}


</style>
