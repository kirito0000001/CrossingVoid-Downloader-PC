import type { TranslationKey } from "./i18n/launcherText";

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
export type RemoteNoticeLevel = "info" | "warning" | "error";
export type RemoteLauncherNotice = {
  schemaVersion: 1;
  id: string;
  enabled: boolean;
  level: RemoteNoticeLevel;
  title: string;
  content: string;
  publishedAt: number;
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
  /** 文件级下载（清单 v1）才有的计数；切片下载不带这两个字段。 */
  doneFiles?: number;
  totalFiles?: number;
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
export type ChunkImportProgressEvent = {
  currentChunk: number;
  totalChunks: number;
  fileName: string;
  processedBytes: number;
  totalBytes: number;
  currentChunkBytes: number;
  currentChunkTotalBytes: number;
  percent: number;
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
