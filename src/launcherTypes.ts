import type { TranslationKey } from "./i18n/launcherText";

// 远程公告/渠道开关的类型定义在两端共用的解析内核里，这里只做转出，
// 免得同一个契约出现第二份声明。
export type { RemoteDownloadChannel, RemoteDownloadChannels, RemoteLauncherNotice, RemoteNoticeLevel } from "./remoteLauncherInfo";

export type LauncherState =
  | "ready"
  | "downloading"
  | "downloaded"
  | "installing"
  | "paused"
  | "checking"
  | "repairPending"
  | "repairing";
export type RepairOperationStage = "idle" | "preparing" | "downloading" | "repairing" | "verifying";
export type SettingsTab = "preferences" | "download" | "game" | "about" | "developer";
export type NewsTab = "characters" | "notice" | "video";
export type InstallDialogMode = "install" | "migration";
export type DownloadSourceKey = "official" | "github";
export type LauncherUpdateStage = "idle" | "checking" | "downloading" | "installing" | "restarting" | "failed";
export type CharacterProfile = {
  name: string;
  work: string;
  tags: string[];
  banner: string;
};
export type NoticeSection = {
  title: string;
  items: string[];
};
export type NoticeBoard = {
  title: string;
  subtitle: string;
  banner: string;
  sections: NoticeSection[];
};
export type VideoItem = {
  title: string;
  date: string;
  video: string;
};
export type ThemeColors = {
  accent?: string;
  support?: string;
};
export type OnSetManifest = {
  colors?: ThemeColors | null;
  characters?: CharacterProfile[];
  notice?: NoticeBoard | null;
  videos?: VideoItem[];
};
export type UpdateManifestPayload = {
  schemaVersion: 2;
  productKey: string;
  downloadReleaseTag: string;
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
export type DownloadArchiveChunk = {
  index?: number;
  count?: number;
  fileName: string;
  githubFileName?: string;
  url?: string;
  sha256?: string;
  sizeBytes?: number;
  objectKey?: string;
};
export type BackendArchiveChunk = {
  index?: number;
  count?: number;
  fileName?: string;
  objectKey?: string;
  sha256?: string;
  sizeBytes?: number;
};
/**
 * 被判定成"游戏在跑"的进程（Rust 侧 list_game_processes 的返回）。
 * path 是进程可执行文件的完整路径；拿不到时是空字符串。
 */
export type GameProcessInfo = {
  processId: number;
  name: string;
  path: string;
};
export type TrafficQuotaResponse = {
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
export type DownloadArchiveInfo = {
  version: string;
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  objectKey?: string;
  chunks?: DownloadArchiveChunk[];
};
export type InstallProgressEvent = {
  stage: string;
  percent: number;
  currentItems?: number;
  totalItems?: number;
};
export type DownloadProgressEvent = {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  /**
   * 这条进度属于哪个安装目录。
   *
   * 玩家可以切到别的档位去逛，下载任务照跑 —— 前端按它把进度归回各自的游戏。
   * 旧的切片下载链路不带这个字段（空串），按"当前档位"处理。
   */
  installPath?: string;
  /** 文件级下载（清单 v1）才有的计数；切片下载不带这两个字段。 */
  doneFiles?: number;
  totalFiles?: number;
};
/**
 * 「核对下载进度」阶段的心跳：逐条哈希本地文件时报"已核对到第几条"。
 *
 * 走单独一条事件（`game-package-scan-progress`）：这一步只该改右侧那行文字，
 * 不能碰字节进度 —— 否则进度条会先掉到 0 再爬回来。
 */
export type GamePackageScanProgressEvent = {
  /** 见 `DownloadProgressEvent.installPath`。 */
  installPath?: string;
  checkedFiles: number;
  totalFiles: number;
  /** 已经对得上清单的条数与字节数：前端拿它驱动进度条（和后面的下载是同一把尺子）。 */
  matchedFiles: number;
  matchedBytes: number;
};
/**
 * Rust 侧"现在在干什么"：`downloading`（在读字节）/ `verifying`（在算 sha256）。
 *
 * 给 900MB 的文件算 sha256 要好几秒，这期间没有字节事件、前端会判成"停滞"，
 * 有了它才能把"网络不佳"换成"校验文件"。
 */
export type GamePackagePhaseEvent = {
  /** 见 `DownloadProgressEvent.installPath`。 */
  installPath?: string;
  phase: string;
};
export type RepairSummary = {
  checkedFiles: number;
  repairedFiles: number;
};
export type ManifestVerifySummary = {
  checkedFiles: number;
  invalidFiles: number;
  missingFiles: number;
};
export type LaunchGameResult = {
  alreadyRunning?: boolean;
  processId?: number;
};
export type RepairProgressEvent = {
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
/**
 * 导入碎片的结果（`import_game_package_files`）。
 *
 * 碎片有散件也有压缩包，但压缩包里的条目名就是清单里的相对路径，
 * 所以 Rust 侧只回"哪些没找到 / 哪些对不上"，不关心它们原来在哪个包里。
 * `missing` 与 `mismatched` 都只列前若干条（给玩家看的，不是给机器用的）。
 */
export type GamePackageImportSummary = {
  importedFiles: number;
  importedBytes: number;
  totalFiles: number;
  totalBytes: number;
  /** 实际用的源根：玩家选的那个文件夹下面几层（解压常常多套一层）。 */
  sourceRoot: string;
  missing: string[];
  mismatched: string[];
};
export type LauncherUpdateConfirmStage = "idle" | "available";
export type DevScriptProgressEvent = {
  stage: string;
  percent: number;
  message: string;
};
export type DevScriptFinishedEvent = {
  script: Exclude<DeveloperTaskKind, "idle">;
  success: boolean;
  code: number;
  message: string;
};
export type DeveloperTaskKind = "idle" | "build" | "publish" | "game-windows" | "game-android";
export type DeveloperGamePublishContext = {
  platform: "Windows" | "Android";
  channel: "Stable" | "Test";
  gameDirectory: string;
  releaseVersion: string;
  releaseTitle: string;
};
export type QuickLink = {
  key: string;
  labelKey: TranslationKey;
  tipKey: TranslationKey;
  iconSrc: string;
  url?: string;
  qr?: string;
  qrAltKey?: TranslationKey;
  compact?: boolean;
};
