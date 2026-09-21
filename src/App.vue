<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { finishBootSplash, updateBootSplash } from "./bootSplash";
import PlatformGameRail from "./components/PlatformGameRail.vue";
import PlatformGameOverview from "./components/PlatformGameOverview.vue";
import PlatformPlaceholderPage from "./components/PlatformPlaceholderPage.vue";
import LauncherToolMenu from "./components/LauncherToolMenu.vue";
import {
  DownloadTimeEstimator,
  formatEtaClock,
  type DownloadEstimate,
} from "./downloadTimeEstimator";
import { githubNetworkWarning, type GithubNetworkStatus } from "./githubNetwork";
import { githubGameChunkAssetName } from "./githubRelease";
import { canPromoteInstalledGame, shouldPreserveSavedOperation } from "./downloadStatePolicy";
import {
  buildGameInstallPath,
  DEFAULT_GAME_INSTALL_PATH,
  DEFAULT_GAME_STORAGE_ROOT,
  inferGameStorageRoot,
  isSameWindowsVolume,
} from "./gameInstallPath";
import {
  canLaunchLocalGame,
  canUseLauncherNetwork,
  type LauncherUpdateGate,
} from "./launcherNetworkPolicy";
import { createPlatformLauncher } from "./platform/platformLauncher";
import { getGamePackageConfig, type PlatformGameId } from "./platform/gameCatalog";
import {
  GAME_PACKAGE_GITHUB_REPOSITORY,
  GamePackageError,
  assertNoGamePackageDowngrade,
  buildGamePackageUrlCandidates,
  buildGamePackagePlan,
  describeGamePackageError,
  githubGameReleaseBaseUrl,
  githubGameReleaseTag,
  githubGameManifestUrl,
  gamePackageManifestUrl,
  pickGitHubGameRelease,
  parseGamePackageManifest,
  parseGamePackageState,
  parseLatestPointer,
  withCacheBuster,
  type GamePackageFile,
  type GamePackageManifest,
  type GamePackagePlan,
  type GitHubReleaseSummary,
} from "./gamePackage";
import {
  DOWNLOAD_CHANNELS_URL,
  LAUNCHER_NOTICE_URL,
  downloadChannelState,
  downloadChannelNotice,
  isDownloadChannelEnabled,
  parseRemoteDownloadChannels,
  parseRemoteLauncherNotice,
  pickAvailableDownloadChannel,
  resolveDownloadChannelStates,
  type RemoteDownloadChannels,
} from "./remoteLauncherInfo";
import {
  activateGameOverviewItem,
  openGameOverview,
  type GameOverviewSelection,
} from "./platform/gameOverviewSelection";
import {
  isLauncherLanguage,
  languageByLabel,
  languageLabels,
  languageOptions,
  translate,
  type LauncherLanguage,
  type TranslationKey,
} from "./i18n/launcherText";
import {
  ChevronLeft,
  CircleAlert,
  Download,
  Gamepad2,
  HardDriveDownload,
  Info,
  Menu,
  Minus,
  PackageOpen,
  Pause,
  RefreshCw,
  Settings,
  Wrench,
  X,
} from "lucide-vue-next";
import type {
  LauncherState,
  RepairOperationStage,
  SettingsTab,
  NewsTab,
  InstallDialogMode,
  DownloadSourceKey,
  LauncherUpdateStage,
  CharacterProfile,
  NoticeBoard,
  RemoteLauncherNotice,
  VideoItem,
  ThemeColors,
  OnSetManifest,
  UpdateManifestPayload,
  DownloadArchiveChunk,
  BackendArchiveChunk,
  GameProcessInfo,
  TrafficQuotaResponse,
  DownloadArchiveInfo,
  InstallProgressEvent,
  DownloadProgressEvent,
  RepairSummary,
  ManifestVerifySummary,
  LaunchGameResult,
  RepairProgressEvent,
  ChunkImportProgressEvent,
  LauncherUpdateConfirmStage,
  QuickLink,
} from "./launcherTypes";
import {
  chunkImportSources,
  downloadSources,
  fallbackCharacterProfiles,
  fallbackNoticeBoard,
  fallbackVideos,
  news,
  newsTabs,
  quickLinks,
} from "./launcherData";
import {
  AUTO_REPAIR_STORAGE_KEY,
  CLOSE_TO_TRAY_STORAGE_KEY,
  DOWNLOAD_LIMITED_STORAGE_KEY,
  DOWNLOAD_SOURCE_STORAGE_KEY,
  DOWNLOAD_STATE_STORAGE_KEY,
  HIDE_AFTER_GAME_LAUNCH_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  OFFLINE_MODE_STORAGE_KEY,
  SPEED_LIMIT_STORAGE_KEY,
  USE_DX11_STORAGE_KEY,
} from "./storageKeys";
import SettingsPanel from "./components/SettingsPanel.vue";
import LauncherCheckbox from "./components/LauncherCheckbox.vue";
import { useSettingsScrollbar } from "./composables/useSettingsScrollbar";
import { settingsContextKey } from "./settings/settingsContext";
import { useDeveloperConsole } from "./dev/useDeveloperConsole";




type PersistedDownloadState = {
  installPath?: string;
  selectedInstallBasePath?: string;
  downloadSource?: DownloadSourceKey;
  activeDownloadSource?: DownloadSourceKey;
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
const platformLauncher = createPlatformLauncher(
  typeof window === "undefined" ? null : window.localStorage,
);
const activeGame = platformLauncher.activeGame;
const activeGameId = platformLauncher.activeGameId;
const leftCollapsed = platformLauncher.detailsCollapsed;
const gameOverviewVisible = platformLauncher.gameOverviewVisible;
const platformGames = platformLauncher.games;
const overviewPreviewGameId = ref<PlatformGameId>(activeGameId.value);
const overviewSelection = ref<GameOverviewSelection>(openGameOverview(activeGameId.value));
const isCrossingVoidActive = computed(() => activeGameId.value === "crossing-void");
const showPlatformGameRail = computed(
  () => !gameOverviewVisible.value && (leftCollapsed.value || !isCrossingVoidActive.value),
);
const savedDownloadedBytes = persistedNumber(savedDownloadState?.downloadedBytes);
const savedTotalBytes = persistedNumber(savedDownloadState?.totalBytes);
/**
 * 这个安装路径上"已经动过手"（下过东西、还没收尾）。
 *
 * 主按钮的文案/分流、进度悬浮栏要不要显示，全都问它 —— **不要问字节数**：
 * 暂停→继续会把本轮要下的字节数清零（逐文件链路连进度条都会从 0 重来），
 * 而在 `.part` 阶段更是一个完整文件都没有。那些时候"还有活没干完"依然是事实。
 * 取下过载、置位、复位的规则见 §「下载与暂停」（本文件内注释）。
 */
const installPathHasPartialWork = ref(
  Boolean(savedDownloadState && normalizePersistedState(savedDownloadState) !== "ready"),
);
const launcherVersion = ref(__APP_VERSION__);
const bundledOnSetManifest = ref<OnSetManifest | null>(null);
const bootSplashMinimumDurationMs = 1800;
const bootSplashStartedAt = Date.now();
// 加载界面在 index.html 里（第一帧就有），这里只把当前游戏的 logo / 短名字同步给它。
updateBootSplash({
  logoSrc: activeGame.value.bootLogoSrc,
  shortLabel: activeGame.value.shortLabel,
});
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
const installDialogMode = ref<InstallDialogMode>("install");
const showGameChunkImportGuide = ref(false);
const selectedChunkFolder = ref("");
const showDevPackageConfirm = ref(false);
const confirmAction = ref<"cancelDownload" | "deleteGame" | "uninstallLauncher">("deleteGame");
const activeSettingsTab = ref<SettingsTab>("preferences");
const versionCheckPending = ref(false);
const pendingRepairSummary = ref<ManifestVerifySummary | null>(
  savedDownloadState?.mode === "repair" ? { checkedFiles: 1, invalidFiles: 1, missingFiles: 1 } : null,
);
const updateAvailable = ref(false);
const updateDownloadPending = ref(savedDownloadState?.mode === "update");
const localGameVersion = ref("");
/** 文件级游戏包（清单 v1）：本次要装的清单与差异计划。 */
const activeGamePackage = shallowRef<GamePackageManifest | null>(null);
const activeGamePackagePlan = shallowRef<GamePackagePlan | null>(null);
/** 进度条上的"已完成/总数（按文件）"，由 Rust 的进度事件带过来。 */
const gamePackageFileProgress = ref({ done: 0, total: 0 });
/**
 * 本轮"逐文件"下载的**文件级基线**：这个安装路径上已经对得上清单的文件（字节 + 个数）。
 *
 * Rust 的进度事件只报"本轮要下的那些文件"，所以暂停→继续会让进度条回到 0。
 * 用它补回整包坐标后，进度只取决于"本地文件对不对得上"—— 暂停、继续、重启都不丢。
 * v1 归档下载与修复下载没有这个概念，进它们之前要清零（否则数字会整体偏移）。
 */
const gamePackageBaseline = ref({ bytes: 0, files: 0 });
/**
 * "继续下载"按下去到真正开始下之间的准备阶段文案。
 *
 * 这一段要拉清单、再把本地文件跟清单逐条对一遍（没有逐文件状态文件时要整盘哈希，慢起来几十秒），
 * 期间进度条是不动的 —— 以前界面上一个字都不说，看着就是卡死。
 */
const gamePackagePrepareStage = ref("");
const remoteGameVersion = ref("");
const lastCheckMessage = ref("");
const trafficQuota = ref<TrafficQuotaResponse | null>(null);
const trafficQuotaPending = ref(false);
const githubNetworkStatus = ref<GithubNetworkStatus | null>(null);
const githubNetworkPending = ref(false);
const gameLaunchPending = ref(false);
const gameRunning = ref(false);
const gameMigrationPending = ref(false);
const launcherUpdatePending = ref(false);
const launcherUpdateStage = ref<LauncherUpdateStage>("idle");
const launcherUpdateConfirmStage = ref<LauncherUpdateConfirmStage>("idle");
const launcherUpdateGate = ref<LauncherUpdateGate>("checking");
const launcherNetworkLocked = computed(() => !canUseLauncherNetwork(launcherUpdateGate.value));
// Tauri's Update instance owns private state and must not be wrapped in a Vue Proxy.
const pendingLauncherUpdate = shallowRef<Update | null>(null);
const launcherUpdateVersion = ref("");
const launcherUpdateDownloadedBytes = ref(0);
const launcherUpdateTotalBytes = ref(0);

const remoteLauncherNotice = ref<RemoteLauncherNotice | null>(null);
const showRemoteLauncherNotice = ref(false);
/** 远程下载渠道开关：开发页发布，玩家侧据此禁用/自动切换下载源。 */
const remoteDownloadChannels = ref<RemoteDownloadChannels | null>(null);
/** 本次清单是从哪个 GitHub Release 拿到的（下载站挂了时也能拼出备用源的文件地址）。 */
const activeGamePackageGithubTag = ref("");
const developerConsole = useDeveloperConsole({
  launcherVersion,
  language: currentLanguage,
  remoteLauncherNotice,
  notify: showCheckResult,
  formatError: formatUnknownError,
  compareVersions,
  fetchRemoteLauncherNotice,
  fetchRemoteDownloadChannels: () => fetchRemoteJson<unknown>(`${DOWNLOAD_CHANNELS_URL}?t=${Date.now()}`),
  onTaskStart: () => {
    showSettings.value = false;
    showDevPackageConfirm.value = false;
  },
});
const {
  disposeDeveloperConsole,
  canPauseDeveloperUpload,
  canResumeDeveloperUpload,
  chooseDeveloperPackagePath,
  developerGameTitle,
  developerGameUploadActive,
  developerGameVersion,
  developerHoldBootSplash,
  developerChannels,
  developerChannelsPending,
  developerChannelsStatus,
  developerNoticeContent,
  developerNoticeLevel,
  developerNoticePending,
  developerNoticeStatus,
  developerNoticeTitle,
  developerPackagePath,
  developerTaskActive,
  developerTaskKind,
  developerTaskPaused,
  developerTaskPauseRequested,
  developerTaskPending,
  developerTaskProgressDetail,
  developerTaskProgressPercent,
  developerTaskStatus,
  developerVersionHint,
  developerVersionInput,
  openDeveloperProjectFolder,
  pauseDeveloperUpload,
  publishDeveloperDownloadChannels,
  publishDeveloperGamePackage,
  publishDeveloperLauncherPackage,
  publishDeveloperRemoteNotice,
  refreshDeveloperLauncherVersion,
  refreshDeveloperDownloadChannels,
  refreshDeveloperRemoteNotice,
  restoreAllDeveloperDownloadChannels,
  resumeDeveloperUpload,
  runDeveloperLauncherBuild,
  saveDeveloperLauncherVersion,
} = developerConsole;

const lastVersionCheckAt = ref(0);
let lastCheckMessageTimer: number | undefined;
let gameRunningPollTimer: number | undefined;
let gameRunningCheckFailures = 0;
let trafficQuotaRefreshTimer: number | undefined;

const settingsScrollbar = useSettingsScrollbar({
  visible: showSettings,
  activeTab: activeSettingsTab,
});
const {
  settingsScrollEl,
  showSettingsScrollbar,
  settingsScrollbarFrameStyle,
  settingsScrollbarThumbTop,
  settingsScrollSpacer,
  updateSettingsScrollbar,
  resetSettingsScrollbar,
  scheduleSettingsScrollbarUpdate,
} = settingsScrollbar;
const showMenu = ref(false);
let toolMenuCloseTimer: number | undefined;
let downloadStateDiskWriteTimer: number | undefined;
let pendingDownloadStatePayload: PersistedDownloadState | null = null;
let restoredDiskDownloadState = false;
const autoRepair = ref(typeof window === "undefined" || window.localStorage.getItem(AUTO_REPAIR_STORAGE_KEY) !== "0");
const installPath = ref(savedDownloadState?.installPath || DEFAULT_GAME_INSTALL_PATH);
const selectedInstallBasePath = ref(savedDownloadState?.selectedInstallBasePath || DEFAULT_GAME_STORAGE_ROOT);
const createDesktopShortcut = ref(true);
const fallbackRequiredInstallBytes = 5 * 1024 * 1024 * 1024;
const remoteArchiveBytes = ref<number | null>(null);
const remoteArchivePending = ref(false);
const availableInstallBytes = ref<number | null>(null);
const migrationRequiredBytes = ref<number | null>(null);
const availableSpacePending = ref(false);
const launcherLanguage = computed({
  get: () => languageLabels[currentLanguage.value],
  set: (label: string) => {
    currentLanguage.value = languageByLabel[label] ?? "zh-Hans";
  },
});
const officialUpdateApiUrl = "https://www.crossingvoid.top/api/toolbox-updates";
const gameMetadataManifestUrl = "https://www.crossingvoid.top/manifests/game/windows-latest.json";
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
const gameDownloadActive = ref(false);
const downloadCancelPending = ref(false);
const activeGameDownloadSource = ref<DownloadSourceKey | null>(
  savedDownloadedBytes > 0
    ? normalizeDownloadSourceKey(savedDownloadState?.activeDownloadSource ?? savedDownloadState?.downloadSource)
    : null,
);
const gameChunkImportPending = ref(false);
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
let chunkImportProgressUnlisten: UnlistenFn | undefined;
let gameProcessExitedUnlisten: UnlistenFn | undefined;
let windowFocusUnlisten: UnlistenFn | undefined;
let bootSplashTimer: number | undefined;
let downloadEstimateRefreshTimer: number | undefined;
const launcherLanguages = computed(() => languageOptions);
const characterProfiles = ref<CharacterProfile[]>(fallbackCharacterProfiles);
const activeCharacterProfile = computed(
  () => characterProfiles.value[activeCharacterBanner.value] ?? characterProfiles.value[0] ?? fallbackCharacterProfiles[0],
);
const currentCharacterBanner = computed(() => activeCharacterProfile.value.banner);
const noticeBoard = ref<NoticeBoard>(fallbackNoticeBoard);
const videos = ref<VideoItem[]>(fallbackVideos);
const activeVideo = ref<VideoItem | null>(null);
const videoFallbackBanner = "/launcher/video-fallback.png";
const t = (key: TranslationKey) => translate(currentLanguage.value, key);
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

if (isCrossingVoidActive.value) startCharacterBannerRotation();

onBeforeUnmount(() => {
  removeLauncherErrorLogging();
  stopCharacterBannerRotation();
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
  if (chunkImportProgressUnlisten) {
    chunkImportProgressUnlisten();
    chunkImportProgressUnlisten = undefined;
  }
  disposeDeveloperConsole();
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
  if (activeGame.value.backgroundSrc) imageSources.add(activeGame.value.backgroundSrc);
  if (activeGame.value.bootLogoSrc) imageSources.add(activeGame.value.bootLogoSrc);
  if (!isCrossingVoidActive.value) {
    await Promise.all([...imageSources].map((src) => preloadImage(src)));
    return;
  }
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
  if (!isCrossingVoidActive.value) {
    updateBootSplash({ status: `正在进入 ${activeGame.value.name}` });
    await Promise.all([waitForBootFonts(1600), preloadBootImages()]);
    return;
  }
  updateBootSplash({ status: "读取主题配置" });
  await loadOnSetColors();
  updateBootSplash({ status: "加载角色轮播" });
  await loadOnSetCharacters();
  updateBootSplash({ status: "加载公告内容" });
  await loadOnSetNoticeBoard();
  updateBootSplash({ status: "加载视频列表" });
  await loadOnSetVideos();
  updateBootSplash({ status: "预载界面资源" });
  await Promise.all([waitForBootFonts(1600), preloadBootImages()]);
}

function hideBootSplash() {
  // 注意：这里**不要**按"是否常驻"提前 return —— 常驻的判断和 Esc 逃生口都在
  // finishBootSplash() 里（以前在这里提前返回，导致常驻时 Esc 根本没挂上）。
  if (bootSplashTimer !== undefined) {
    window.clearTimeout(bootSplashTimer);
  }
  const remainingDuration = Math.max(
    0,
    bootSplashMinimumDurationMs - (Date.now() - bootSplashStartedAt),
  );
  bootSplashTimer = window.setTimeout(() => {
    finishBootSplash();
    bootSplashTimer = undefined;
  }, remainingDuration + 180);
}

async function initializePlatformPage() {
  const hasLauncherUpdate = await checkLauncherUpdate({ manual: false });
  // 公告不受"必须先更新启动器"的限制，先拉一次再决定要不要继续初始化平台页。
  await refreshRemoteLauncherNotice();
  // 渠道开关同样先拉：玩家可能正因为某个源被关而进不来。
  await refreshRemoteDownloadChannels();
  if (hasLauncherUpdate || launcherUpdateGate.value !== "ready" || !isCrossingVoidActive.value) return;
  await checkGameVersion({ manual: false });
  await Promise.all([
    refreshTrafficQuota(),
    ...(downloadSource.value === "github" ? [refreshGithubNetworkStatus()] : []),
  ]);
  if (trafficQuotaRefreshTimer === undefined) {
    trafficQuotaRefreshTimer = window.setInterval(() => void refreshTrafficQuota(), 5 * 60 * 1000);
  }
}

async function selectPlatformGame(id: PlatformGameId) {
  if (activeGameId.value === id && !gameOverviewVisible.value) return;
  platformLauncher.selectGame(id);
  showSettings.value = false;
  showMenu.value = false;
  showInstallConfirm.value = false;
  showGameChunkImportGuide.value = false;
  if (id === "crossing-void") {
    startCharacterBannerRotation();
    await loadBootResources();
    await initializePlatformPage();
  } else {
    stopCharacterBannerRotation();
  }
}

function openPlatformGameOverview() {
  overviewSelection.value = openGameOverview(activeGameId.value);
  overviewPreviewGameId.value = overviewSelection.value.previewGameId;
  platformLauncher.setGameOverviewVisible(true);
  showSettings.value = false;
  showMenu.value = false;
}

async function activateOverviewGame(id: PlatformGameId) {
  const result = activateGameOverviewItem(overviewSelection.value, id);
  overviewSelection.value = result.state;
  overviewPreviewGameId.value = result.state.previewGameId;
  if (result.action === "select") {
    return;
  }
  await selectPlatformGame(id);
}

function togglePlatformDetails() {
  platformLauncher.toggleDetails();
}

onMounted(() => {
  installLauncherErrorLogging();
  downloadEstimateRefreshTimer = window.setInterval(() => {
    if (launcherState.value !== "downloading") return;
    downloadEstimate.value = downloadTimeEstimator.getEstimate(performance.now());
  }, 1_000);
  void (async () => {
    const bootStartedAt = performance.now();
    try {
      updateBootSplash({ status: "读取本地状态" });
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
        if (event.payload && isCrossingVoidActive.value) void refreshExternalInstallState();
      });
      await nextTick();

      updateBootSplash({ status: "准备界面资源" });
      await Promise.all([wait(Math.max(0, 900 - (performance.now() - bootStartedAt))), loadBootResources()]);
    } catch (error) {
      console.warn("Launcher boot initialization failed", error);
    } finally {
      await initializePlatformPage();
      hideBootSplash();
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
const localGamePlayableWhileNetworkLocked = computed(() =>
  canLaunchLocalGame(launcherUpdateGate.value, hasLocalInstalledGame.value),
);
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
    (launcherState.value === "paused" && installPathHasPartialWork.value))),
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
const canCancelGameDownload = computed(
  () =>
    !downloadCancelPending.value &&
    (launcherState.value === "downloading" ||
      (launcherState.value === "paused" && downloadedBytes.value > 0)),
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
    (gameDownloadActive.value && launcherState.value !== "downloading") ||
    gameLaunchPending.value ||
    // 注意：**不把 gameRunning 算进禁用条件**。以前它在这里，于是一旦进程判定出了岔子
    // （2026-09-21：机器上有个同名进程），按钮就永远锁在"游戏运行中"，玩家没有任何出路。
    // 现在的做法是：按钮照常可点，点下去再问玩家"要不要强制结束那个卡住的进程并重启"。
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
const gameChunkImportDisabled = computed(
  () =>
    hasLocalInstalledGame.value ||
    gameChunkImportPending.value ||
    launcherUpdateActive.value ||
    developerTaskActive.value ||
    gameLaunchPending.value ||
    gameRunning.value ||
    versionCheckPending.value ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairing",
);
const downloadSourceDisabled = computed(
  () =>
    availableDownloadSources.value.every(
      (source) => !isDownloadChannelEnabled(downloadChannelStates.value, source.key),
    ) ||
    launcherUpdateActive.value ||
    developerTaskActive.value ||
    launcherState.value === "downloading" ||
    launcherState.value === "installing" ||
    launcherState.value === "checking" ||
    launcherState.value === "repairing",
);


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
  if (localGamePlayableWhileNetworkLocked.value) return t("action.launchGame");
  if (offlinePlayable.value) return t("action.launchGame");
  if (versionCheckPending.value) return t("status.versionChecking");
  if (repairDownloadPauseRequested.value) return "正在暂停";
  if (downloadPauseRequested.value && gameDownloadActive.value) return "正在暂停";
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
  return installPathHasPartialWork.value ? t("action.resumeDownload") : t("action.downloadGame");
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
  if (localGamePlayableWhileNetworkLocked.value) return Gamepad2;
  if (offlinePlayable.value) return Gamepad2;
  if (launcherState.value === "downloading") return Pause;
  if (launcherState.value === "repairPending") return CircleAlert;
  if (versionCheckPending.value || launcherState.value === "checking" || launcherState.value === "installing" || launcherState.value === "repairing") return RefreshCw;
  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) return PackageOpen;
  if (launcherState.value === "ready" && updateAvailable.value && !offlineMode.value) return HardDriveDownload;
  if (launcherState.value === "ready") return Gamepad2;
  return Download;
});
const showGameChunkImportAction = computed(
  () =>
    !hasLocalInstalledGame.value &&
    launcherState.value !== "downloaded" &&
    !hasCompleteDownloadedArchive.value,
);

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
  if (gameChunkImportPending.value && verificationCurrentFileName.value) {
    const current = repairProgressItems.value?.checked ?? 0;
    const total = repairProgressItems.value?.total ?? 0;
    return total > 0
      ? `正在校验游戏碎片 ${current}/${total}：${verificationCurrentFileName.value}`
      : `正在校验游戏碎片：${verificationCurrentFileName.value}`;
  }
  if (gameChunkImportPending.value) return "正在校验游戏碎片";
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
  if (launcherState.value === "downloading") {
    // 准备阶段（获取清单 / 核对上次进度）优先说出来：这一段进度条不动，
    // 不吭声就会被当成卡死。
    if (gamePackagePrepareStage.value) return gamePackagePrepareStage.value;
    return activeGameDownloadSourceName.value
      ? `下载游戏中：${activeGameDownloadSourceName.value}`
      : t("status.downloading");
  }
  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) return t("status.downloaded");
  if (launcherState.value === "ready") return t("status.ready");
  if (updateDownloadPending.value) return t("status.paused");
  if (installPathHasPartialWork.value) {
    return activeGameDownloadSourceName.value
      ? `下载已暂停：${activeGameDownloadSourceName.value}`
      : t("status.paused");
  }
  return t("status.waiting");
});
const downloadEstimateCopy = computed(() => {
  if (launcherState.value !== "downloading") return "";
  if (downloadEstimate.value.status === "stalled") return "网络不佳";
  if (downloadEstimate.value.status !== "ready") return "--:--";
  return formatEtaClock(downloadEstimate.value.remainingSeconds) ?? "网络不佳";
});
const displayedProgressMb = computed(() => (launcherState.value === "installing" ? totalMb.value : downloadedMb.value));
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
const gamePackageProgressDetail = computed(() => {
  if (launcherState.value !== "downloading") return "";
  const progress = gamePackageFileProgress.value;
  if (progress.total <= 0) return "";
  return `${Math.min(progress.done, progress.total)}/${progress.total} 个文件`;
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
const canCheckGameUpdates = computed(() =>
  hasLocalInstalledGame.value && !hasActiveDownloadTask.value && !launcherNetworkLocked.value,
);
const canVerifyGameIntegrity = computed(
  () =>
    !hasActiveDownloadTask.value &&
    launcherState.value !== "checking" &&
    launcherState.value !== "repairing",
);
const finalInstallPath = computed(() => buildGameInstallPath(selectedInstallBasePath.value));
const migrationChangesVolume = computed(() =>
  !isSameWindowsVolume(installPath.value, finalInstallPath.value),
);
const installDialogTitle = computed(() =>
  t(installDialogMode.value === "migration" ? "install.migrationTitle" : "install.title"),
);
const installDialogConfirmText = computed(() =>
  t(installDialogMode.value === "migration" ? "install.confirmMigration" : "install.continue"),
);
const availableSpaceCopy = computed(() => {
  if (availableSpacePending.value) return t("space.checking");
  if (availableInstallBytes.value == null) return t("space.unavailable");
  return formatBytes(availableInstallBytes.value);
});
const requiredInstallBytes = computed(() =>
  installDialogMode.value === "migration"
    ? migrationRequiredBytes.value ?? 0
    : (remoteArchiveBytes.value ?? fallbackRequiredInstallBytes) * 2,
);
const requiredSpaceCopy = computed(() => {
  if (installDialogMode.value === "migration" && migrationRequiredBytes.value == null) return t("space.querying");
  if (remoteArchivePending.value && remoteArchiveBytes.value == null) return t("space.querying");
  return formatBytes(requiredInstallBytes.value);
});
const isInstallSpaceLow = computed(
  () =>
    (installDialogMode.value === "install" || migrationChangesVolume.value) &&
    requiredInstallBytes.value > 0 &&
    availableInstallBytes.value != null &&
    availableInstallBytes.value < requiredInstallBytes.value,
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

const activeNewsItems = computed(() => (activeNewsTab.value === "video" ? videos.value : news[activeNewsTab.value as keyof typeof news] ?? []));


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
    void refreshDeveloperLauncherVersion();
    void refreshDeveloperDownloadChannels();
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
const githubNetworkWarningText = computed(() =>
  githubNetworkStatus.value ? githubNetworkWarning(githubNetworkStatus.value) : "",
);
const showGithubNetworkWarning = computed(
  () => downloadSource.value === "github" && Boolean(githubNetworkWarningText.value),
);
const githubProxyText = computed(() => {
  if (githubNetworkPending.value) return "正在检测";
  if (!githubNetworkStatus.value) return "等待检测";
  return githubNetworkStatus.value.proxyDetected ? "已检测到网络代理" : "未检测到网络代理";
});
const dangerConfirmTitle = computed(() => {
  if (confirmAction.value === "cancelDownload") return t("confirm.cancelDownloadTitle");
  if (confirmAction.value === "uninstallLauncher") return t("confirm.uninstallLauncherTitle");
  return t("confirm.deleteTitle");
});
const dangerConfirmBody = computed(() => {
  if (confirmAction.value === "cancelDownload") return t("confirm.cancelDownloadBody");
  if (confirmAction.value === "uninstallLauncher") return t("confirm.uninstallLauncherBody");
  return t("confirm.deleteBody");
});
const dangerConfirmActionCopy = computed(() => {
  if (downloadCancelPending.value) return t("action.cancelling");
  if (confirmAction.value === "cancelDownload") return t("confirm.cancelDownload");
  if (confirmAction.value === "uninstallLauncher") return t("confirm.uninstallLauncher");
  return t("confirm.delete");
});
const githubLatencyText = computed(() => {
  if (githubNetworkPending.value) return "正在检测";
  if (!githubNetworkStatus.value) return "等待检测";
  if (!githubNetworkStatus.value.reachable || githubNetworkStatus.value.latencyMs === null) return "无法连接";
  return `${githubNetworkStatus.value.latencyMs} ms`;
});
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
/** 远程渠道开关落到本地渠道表上的结果（远端没提到的渠道默认开放）。 */
const downloadChannelStates = computed(() =>
  resolveDownloadChannelStates(
    downloadSources.map((source) => source.key),
    remoteDownloadChannels.value,
  ),
);
/** 设置页里补充说明：只列"有写明原因"的渠道，右上角那条提示已经覆盖了"被关"本身。 */
const downloadChannelNoticeText = computed(() =>
  downloadChannelNotice(
    downloadChannelStates.value,
    (key) => downloadSourceNameByKey.value[key],
  ),
);
/** 当前下载源被远端关掉时，直接复用右上角那条提示（和"流量不足"同一套外观）。 */
const downloadChannelWarningText = computed(() =>
  downloadChannelState(downloadChannelStates.value, downloadSource.value).enabled
    ? ""
    : "当前渠道已关闭，请更换",
);
/** 还开着的下载源；全关时回落到完整列表，好让界面仍能显示"已关闭"。 */
const availableDownloadSources = computed(() => {
  const available = downloadSources.filter((source) =>
    isDownloadChannelEnabled(downloadChannelStates.value, source.key),
  );
  return available.length > 0 ? available : downloadSources;
});
const activeGameDownloadSourceName = computed(() => {
  const source = activeGameDownloadSource.value;
  return source ? downloadSourceNameByKey.value[source] : "";
});
const downloadSourceKeyByName = computed(() =>
  Object.fromEntries(downloadSources.map((source) => [t(source.nameKey), source.key])) as Record<string, DownloadSourceKey>,
);
const downloadSourceModel = computed({
  get: () => downloadSourceNameByKey.value[downloadSource.value],
  set: (label: string) => {
    downloadSource.value = downloadSourceKeyByName.value[label] ?? "official";
  },
});
const downloadSourceOptions = computed(() =>
  availableDownloadSources.value.map((source) =>
    isDownloadChannelEnabled(downloadChannelStates.value, source.key)
      ? t(source.nameKey)
      : `${t(source.nameKey)}（已关闭）`,
  ),
);

watch([showSettings, activeSettingsTab], () => {
  resetSettingsScrollbar();
  if (isCrossingVoidActive.value && showSettings.value && activeSettingsTab.value === "download") {
    if (downloadSource.value === "official") void refreshTrafficQuota();
    else void refreshGithubNetworkStatus();
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
  if (!isCrossingVoidActive.value) return;
  if (source === "github") void refreshGithubNetworkStatus();
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


watch([installPath, selectedInstallBasePath, downloadSource], () => {
  persistDownloadState(currentPersistableState(), "immediate");
});

watch([showInstallConfirm, finalInstallPath], ([visible]) => {
  if (!visible) return;
  void refreshInstallDialogSpace();
});

watch([showInstallConfirm, downloadSource], ([visible]) => {
  if (!visible || installDialogMode.value !== "install") return;
  void updateRemoteArchiveInfo();
});

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
  // "downloaded" 和 "paused" 不能共用一句判据：
  // - "downloaded"：下载阶段已经结束，归档/分片必须齐，不然装不出来。
  // - "paused"：下载被打断，磁盘上本来就不该有完整归档 —— 到 Rust 侧只要求"这单的地盘还在"。
  //   以前两种情况都按"必须齐"来判，于是每一条被打断的下载在下次启动都会被判无效、
  //   进度被清掉，用户看到的就是"又重新开始下载"（2026-09-21 报的断点失效）。
  const targetState =
    state.state === "ready" ? "ready" : state.state === "downloaded" ? "downloaded" : "paused";
  // `paused` 不再看 `downloadedBytes`：进度现在是"文件对得上"的字节数，
  // 停在一个 `.part` 上的任务本来就可能是 0 —— 拿 0 判死它又会把进度清掉。
  // "这单还在不在"交给下面的磁盘判据回答。
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
    // 已经是一个完整安装，不再是"下到一半的活"。
    installPathHasPartialWork.value = false;
    persistDownloadState("ready", "immediate");
    return true;
  } catch (error) {
    console.warn("Unable to validate restored game install", error);
    return false;
  }
}

async function refreshExternalInstallState() {
  if (!isCrossingVoidActive.value) return false;
  if (launcherState.value === "ready") return true;
  const restored = await restoreReadyInstallFromFiles();
  if (!restored) return false;

  await readLocalGameVersion();
  if (!offlineMode.value && !launcherNetworkLocked.value) await checkGameVersion({ manual: false });
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
    activeDownloadSource: activeGameDownloadSource.value ?? undefined,
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

async function fetchRemoteJson<T>(url: string) {
  const text = await invoke<string>("fetch_remote_text", { url });
  return JSON.parse(text) as T;
}

async function fetchRemoteLauncherNotice() {
  const payload = await fetchRemoteJson<unknown>(`${LAUNCHER_NOTICE_URL}?t=${Date.now()}`);
  const notice = parseRemoteLauncherNotice(payload);
  if (!notice) throw new Error("远程公告格式不正确");
  return notice;
}

/**
 * 远程下载渠道开关：拉一次，然后据此调整当前下载源。
 *
 * 被关掉的渠道不允许选中；当前渠道被关就自动切到还开着的那个；
 * 全都关了则保留选择，但下载入口会被 `downloadGameArchive` 拦下并显示说明。
 */
async function refreshRemoteDownloadChannels() {
  if (!isCrossingVoidActive.value) return;
  try {
    const payload = await fetchRemoteJson<unknown>(`${DOWNLOAD_CHANNELS_URL}?t=${Date.now()}`);
    remoteDownloadChannels.value = parseRemoteDownloadChannels(payload);
  } catch (error) {
    console.warn("Unable to load remote download channels", error);
    // 拉不到就按"全部开放"处理：不能因为一次网络抖动把所有人挡在门外。
    remoteDownloadChannels.value = null;
  }

  const available = pickAvailableDownloadChannel(downloadChannelStates.value, downloadSource.value);
  if (available && available !== downloadSource.value) {
    downloadSource.value = available;
    showCheckResult(
      `当前下载渠道已关闭，已自动切换到「${downloadSourceNameByKey.value[available]}」。`,
    );
  }
}

async function refreshRemoteLauncherNotice() {
  // 公告是运营的通知渠道，不跟着"必须先更新启动器"的网络锁一起禁掉：
  // 恰恰在有更新待装时，玩家更需要看到"维护公告/暂不开放下载"这类信息。
  if (!isCrossingVoidActive.value) return;
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


async function refreshTrafficQuota() {
  if (!isCrossingVoidActive.value || launcherNetworkLocked.value) return;
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

async function refreshGithubNetworkStatus() {
  if (!isCrossingVoidActive.value || launcherNetworkLocked.value) return;
  if (githubNetworkPending.value) return;
  githubNetworkPending.value = true;
  try {
    githubNetworkStatus.value = await invoke<GithubNetworkStatus>("get_github_network_status");
  } catch (error) {
    console.warn("Unable to detect Github network status", error);
    githubNetworkStatus.value = { proxyDetected: false, reachable: false, latencyMs: null };
  } finally {
    githubNetworkPending.value = false;
  }
}

function ensureOfficialTrafficAvailable() {
  if (downloadSource.value !== "official" || !officialTrafficBlocked.value) return true;
  showCheckResult(t("traffic.low"));
  return false;
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
      launcherVersion: launcherVersion.value,
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

// ——— 文件级游戏包（清单 v1）：与 Android 共用同一套内核 ———
// 下载站 → latest.json → 清单 → 本地状态/扫描 → 差异计划，全部走 src/gamePackage.ts。
// 还没有接入下载站的游戏仍然走下面的 v2 切片链路（downloadLegacyGameArchive）。

function currentGamePackageConfig() {
  return getGamePackageConfig(activeGameId.value);
}

async function fetchGamePackageManifest(): Promise<GamePackageManifest> {
  const config = currentGamePackageConfig();
  if (!config) {
    throw new GamePackageError("manifest-invalid", "当前游戏还没有接入下载站。");
  }
  const expectation = { productKey: config.productKey, runtime: config.runtime };
  const officialEnabled = isDownloadChannelEnabled(downloadChannelStates.value, "official");
  const githubEnabled = isDownloadChannelEnabled(downloadChannelStates.value, "github");
  const failures: string[] = [];

  // ① 下载站：latest.json → manifestUrl
  if (officialEnabled) {
    try {
      const pointer = parseLatestPointer(
        await fetchRemoteJson<unknown>(withCacheBuster(gamePackageManifestUrl(config.productSegment))),
      );
      const manifest = parseGamePackageManifest(
        await fetchRemoteJson<unknown>(withCacheBuster(pointer.manifestUrl)),
        expectation,
      );
      activeGamePackageGithubTag.value = githubGameReleaseTag("PC", manifest.version);
      return manifest;
    } catch (error) {
      failures.push(describeGamePackageError(error));
    }
  }

  // ② 备用源：GitHub Release 里同样放了一份 manifest.json —— 下载站挂了这个还能用。
  if (githubEnabled) {
    try {
      const releases = await fetchRemoteJson<GitHubReleaseSummary[]>(
        withCacheBuster(githubGameReleasesUrl()),
      );
      const picked = pickGitHubGameRelease(releases, { tagPrefix: "PC-V" });
      if (!picked) throw new GamePackageError("manifest-invalid", "GitHub 上没有找到本平台的游戏包。");
      const manifest = parseGamePackageManifest(
        await fetchRemoteJson<unknown>(
          withCacheBuster(githubGameManifestUrl(GAME_PACKAGE_GITHUB_REPOSITORY, picked.tag)),
        ),
        expectation,
      );
      activeGamePackageGithubTag.value = picked.tag;
      return manifest;
    } catch (error) {
      failures.push(describeGamePackageError(error));
    }
  }

  throw new GamePackageError(
    "network-interrupted",
    failures.length > 0
      ? `无法读取游戏清单：${failures.join("；")}`
      : "当前没有开放的下载渠道，暂时无法获取游戏清单。",
  );
}

function githubGameReleasesUrl() {
  const repo = GAME_PACKAGE_GITHUB_REPOSITORY.trim().replace(/^\/+|\/+$/g, "");
  return `https://api.github.com/repos/${repo}/releases?per_page=10`;
}

/**
 * 本地状态 → 差异计划。
 * 没有状态文件时（老安装升上来）先逐文件哈希一次，玩家就不必重下已有的文件。
 */
async function resolveGamePackagePlan(manifest: GamePackageManifest) {
  const rawState = await invoke<unknown | null>("read_game_package_state", {
    installPath: installPath.value,
  });
  const state = parseGamePackageState(rawState);
  if (!state) {
    // 没有逐文件状态文件（下到一半停了、或者老安装升级上来）时要整盘对一遍哈希，
    // 这是整个准备阶段最慢的一步，必须说出来。
    gamePackagePrepareStage.value = "核对下载进度";
  }
  const scanned = state
    ? null
    : await invoke<GamePackageFile[]>("scan_local_game_package", {
        installPath: installPath.value,
        files: manifest.files,
      });
  const plan = buildGamePackagePlan(
    manifest,
    state?.files ?? scanned,
    state?.files.map((entry) => entry.path) ?? [],
  );
  return { state, plan };
}

async function resolveGamePackage() {
  const manifest = await fetchGamePackageManifest();
  assertNoGamePackageDowngrade(manifest, localGameVersion.value);
  const { plan } = await resolveGamePackagePlan(manifest);
  activeGamePackage.value = manifest;
  activeGamePackagePlan.value = plan;
  return { manifest, plan };
}

/** 文件级下载：只下 sha256 变了的文件；`.part`、Range 续传、sha256 校验都在 Rust 侧。 */
async function downloadGamePackageFiles() {
  gamePackagePrepareStage.value = "获取游戏清单";
  const { manifest, plan } = await resolveGamePackage();
  const packageBytes = manifest.files.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  // 进度按"文件对得上"算：分母是整包，分子是本地已经对上的那些文件。
  // 事件只报"本轮要下的文件"的进度，所以这里先记下基线补回整包坐标 ——
  // 这样暂停→继续、重启后继续，进度条都不会回到 0。
  gamePackageBaseline.value = {
    bytes: Math.max(0, packageBytes - plan.totalBytes),
    files: Math.max(0, manifest.files.length - plan.download.length),
  };
  activeDownloadBytes.value = packageBytes || remoteArchiveBytes.value || fallbackRequiredInstallBytes;
  remoteArchiveBytes.value = activeDownloadBytes.value;
  downloadedBytes.value = gamePackageBaseline.value.bytes;
  downloadedMb.value = bytesToMb(downloadedBytes.value);
  gamePackageFileProgress.value = {
    done: gamePackageBaseline.value.files,
    total: manifest.files.length,
  };
  downloadEstimate.value = downloadTimeEstimator.record(
    downloadedBytes.value,
    activeDownloadBytes.value,
    performance.now(),
  );
  persistDownloadState("paused", "immediate");
  // 清单和差异都算好了：准备阶段到此结束，后面交给进度事件。
  gamePackagePrepareStage.value = "";

  if (plan.download.length > 0) {
    // 每个文件带上候选地址：首选源排第一，另一个源兜底（被渠道开关关掉的源不参与）。
    const githubReleaseBase = githubGameReleaseBaseUrl(
      GAME_PACKAGE_GITHUB_REPOSITORY,
      activeGamePackageGithubTag.value || githubGameReleaseTag("PC", manifest.version),
    );
    const officialEnabled = isDownloadChannelEnabled(downloadChannelStates.value, "official");
    const githubEnabled = isDownloadChannelEnabled(downloadChannelStates.value, "github");
    const files = plan.download.map((entry) => ({
      ...entry,
      urls: buildGamePackageUrlCandidates({
        path: entry.path,
        officialBaseUrl: manifest.baseUrl,
        githubReleaseBaseUrl: githubReleaseBase,
        preferred: downloadSource.value,
        officialEnabled,
        githubEnabled,
      }),
    }));
    await invoke("download_game_package", {
      installPath: installPath.value,
      baseUrl: manifest.baseUrl,
      files,
      concurrency: 4,
    });
  }

  downloadedBytes.value = activeDownloadBytes.value;
  downloadedMb.value = bytesToMb(downloadedBytes.value);
  gamePackageFileProgress.value = {
    done: manifest.files.length,
    total: manifest.files.length,
  };
}

/** 文件已经落位，安装阶段只剩：清旧文件（白名单）→ 写状态文件 → 复核 ready。 */
async function finalizeGamePackageInstall() {
  const manifest = activeGamePackage.value;
  if (!manifest) throw new GamePackageError("manifest-invalid", "还没有取得游戏清单。");

  gameOperationCancelRequested.value = false;
  try {
    launcherState.value = "installing";
    installProgressPercent.value = 0;
    installProgressStage.value = "verifying";
    installProgressItems.value = null;
    downloadPauseRequested.value = false;
    await ensureInstallProgressListener();

    const prunePaths = activeGamePackagePlan.value?.prune ?? [];
    if (prunePaths.length > 0) {
      await invoke("prune_game_package", {
        installPath: installPath.value,
        paths: prunePaths,
      });
    }

    await invoke("write_game_package_state", {
      installPath: installPath.value,
      productKey: manifest.productKey,
      version: manifest.version,
      files: manifest.files,
    });

    const installReady = await invoke<boolean>("validate_game_install_state", {
      installPath: installPath.value,
      state: "ready",
    });
    if (!installReady) {
      throw new Error("游戏文件已就位，但安装校验没有通过。");
    }

    if (createDesktopShortcut.value) {
      await invoke("create_game_desktop_shortcut_now", { installPath: installPath.value }).catch(
        (error) => console.warn("Unable to create desktop shortcut", error),
      );
    }
    await invoke("install_vc_redist", { installPath: installPath.value }).catch((error) =>
      console.warn("Unable to install VC redist", error),
    );

    const installedBytes = activeDownloadBytes.value ?? 0;
    downloadedBytes.value = installedBytes;
    downloadedMb.value = bytesToMb(installedBytes);
    launcherState.value = "ready";
    clearUpdateDownloadContext();
    persistDownloadState("ready", "immediate");
    await readLocalGameVersion();
  } catch (error) {
    console.error("Game install failed", error);
    launcherState.value = "downloaded";
    installProgressPercent.value = 0;
    installProgressItems.value = null;
    persistDownloadState("downloaded", "immediate");
    showSettings.value = false;
    showInstallConfirm.value = false;
    showMenu.value = false;
    showCheckResult(`安装游戏失败：${describeGamePackageError(error)}`);
  }
}

async function updateRemoteArchiveInfo() {
  remoteArchivePending.value = true;
  try {
    if (currentGamePackageConfig()) {
      const manifest = await fetchGamePackageManifest();
      const total = manifest.files.reduce((sum, entry) => sum + entry.sizeBytes, 0);
      remoteArchiveBytes.value = total || null;
    } else {
      const info = await fetchGameMetadataArchiveInfo();
      remoteArchiveBytes.value = info.sizeBytes || null;
    }
  } catch (error) {
    console.warn("Unable to query remote archive info", error);
    remoteArchiveBytes.value = null;
  } finally {
    remoteArchivePending.value = false;
  }
}

async function fetchGameMetadataArchiveInfo(): Promise<DownloadArchiveInfo> {
  const manifest = await fetchGameMetadataManifest();
  const asset = getUpdateManifestAsset(manifest);
  if (!asset?.fileName) throw new Error("update manifest missing archive file name");
  return {
    version: manifest.latest?.version || "",
    fileName: asset.fileName,
    url: "",
    sha256: asset.sha256 || "",
    sizeBytes: getRemoteArchiveBytes(manifest) ?? 0,
    objectKey: asset.objectKey,
    chunks: asset.chunks ?? [],
  };
}

async function fetchGameMetadataManifest(): Promise<UpdateManifestPayload> {
  const separator = gameMetadataManifestUrl.includes("?") ? "&" : "?";
  const payload = await fetchRemoteJson<unknown>(`${gameMetadataManifestUrl}${separator}t=${Date.now()}`);
  return validateGameMetadataManifest(payload);
}

function validateGameMetadataManifest(payload: unknown): UpdateManifestPayload {
  if (!payload || typeof payload !== "object") throw new Error("游戏更新清单格式无效。");
  const manifest = payload as Record<string, unknown>;
  if (manifest.schemaVersion !== 2) throw new Error("游戏更新清单版本不受支持，请更新启动器。");
  if (manifest.productKey !== officialProductKey) throw new Error("游戏更新清单产品标识不正确。");
  if (typeof manifest.downloadReleaseTag !== "string" || !manifest.downloadReleaseTag.trim()) {
    throw new Error("游戏更新清单缺少 Github 下载标签。");
  }
  return payload as UpdateManifestPayload;
}

async function resolveGameMetadataDownload(source: DownloadSourceKey): Promise<DownloadArchiveInfo> {
  const manifest = await fetchGameMetadataManifest();
  const asset = getUpdateManifestAsset(manifest);
  if (!asset?.fileName) throw new Error("update manifest missing archive file name");
  const version = manifest.latest?.version || "";
  const rawChunks = asset.chunks ?? [];
  const chunks = source === "official"
    ? await resolveBackendChunks(version, officialRuntime, rawChunks)
    : rawChunks.map((chunk) => ({
        ...chunk,
        url: `https://github.com/${githubGameRepository}/releases/download/${encodeURIComponent(manifest.downloadReleaseTag)}/${encodeURIComponent(githubGameChunkAssetName({ ...chunk, fileName: chunk.githubFileName || chunk.fileName }))}`,
      }));
  return {
    version,
    fileName: asset.fileName,
    url: "",
    sha256: asset.sha256 || "",
    sizeBytes: getRemoteArchiveBytes(manifest) ?? 0,
    objectKey: asset.objectKey,
    chunks,
  };
}

async function resolveDownloadArchiveInfo(source: DownloadSourceKey = downloadSource.value): Promise<DownloadArchiveInfo> {
  return resolveGameMetadataDownload(source);
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


async function isDevelopmentBuild() {
  if (import.meta.env.DEV) return true;
  try {
    return await invoke<boolean>("is_debug_build");
  } catch {
    return false;
  }
}

async function refreshInstallDialogSpace() {
  migrationRequiredBytes.value = null;
  const requests: Promise<unknown>[] = [updateAvailableInstallSpace()];
  if (installDialogMode.value === "migration" && migrationChangesVolume.value) {
    requests.push(
      invoke<number>("get_game_migration_size", { installPath: installPath.value })
        .then((bytes) => { migrationRequiredBytes.value = bytes; })
        .catch((error) => {
          console.warn("Unable to calculate game migration size", error);
          migrationRequiredBytes.value = null;
        }),
    );
  }
  await Promise.all(requests);
}




async function openLauncherLogFolder() {
  try {
    await invoke("open_launcher_log_folder");
  } catch (error) {
    console.warn("Unable to open launcher log folder", error);
    showCheckResult(`打开日志目录失败：${formatUnknownError(error)}`);
  }
}

async function openGameLogFolder() {
  try {
    await invoke("open_game_log_folder");
  } catch (error) {
    console.warn("Unable to open game log folder", error);
    showCheckResult(`打开游戏日志失败：${formatUnknownError(error)}`);
  }
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

const nativeConsoleError = console.error.bind(console);
const recentLauncherErrors = new Map<string, number>();

function formatLauncherErrorDetail(error: unknown) {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error || "未知错误");
  }
}

function launcherErrorFingerprint(detail: string) {
  return detail
    .split(/\r?\n/, 1)[0]
    .replace(/^(?:Error|TypeError|RangeError):\s*/i, "")
    .replace(/^[^：]{1,40}：\s*/, "")
    .trim()
    .slice(0, 500);
}

function launcherErrorFileTimestamp(date: Date) {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function resolveChineseErrorTitle(context: string) {
  const mappings: Array<[RegExp, string]> = [
    [/Game chunk import failed/i, "安装游戏分片失败"],
    [/Game install failed/i, "安装游戏失败"],
    [/Game download failed/i, "下载游戏失败"],
    [/Automatic game file check failed/i, "自动检查游戏文件失败"],
    [/Unable to verify game integrity/i, "验证游戏完整性失败"],
    [/Unable to repair game files/i, "修复游戏文件失败"],
    [/Launcher update check failed/i, "检查启动器更新失败"],
    [/Launcher update failed/i, "更新启动器失败"],
    [/Unable to publish game package/i, "发布游戏包失败"],
    [/Unable to publish remote launcher notice/i, "发布远程公告失败"],
  ];
  return mappings.find(([pattern]) => pattern.test(context))?.[1] || "启动器运行错误";
}

function launcherErrorTitleFromMessage(message: string) {
  const prefix = message.split(/[：:]/, 1)[0].trim();
  return prefix && prefix.length <= 32 ? prefix : "启动器运行错误";
}

function isLauncherErrorMessage(message: string) {
  return /失败|错误|异常|无法|未找到/.test(message);
}

async function recordLauncherError(title: string, error: unknown, extraContext = "") {
  const detail = formatLauncherErrorDetail(error);
  const fingerprint = launcherErrorFingerprint(detail);
  const now = Date.now();
  for (const [key, recordedAt] of recentLauncherErrors) {
    if (now - recordedAt > 5_000) recentLauncherErrors.delete(key);
  }
  if (fingerprint && recentLauncherErrors.has(fingerprint)) return;
  if (fingerprint) recentLauncherErrors.set(fingerprint, now);

  const occurredAt = new Date(now);
  const context = [
    `启动器版本：${launcherVersion.value || "未知"}`,
    `游戏状态：${launcherState.value}`,
    `下载源：${downloadSource.value}`,
    `安装目录：${installPath.value}`,
    extraContext,
    `页面地址：${window.location.href}`,
    `系统信息：${navigator.userAgent}`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await invoke<string>("write_launcher_error_log", {
      title,
      detail,
      context,
      occurredAt: occurredAt.toLocaleString("zh-CN", { hour12: false }),
      fileTimestamp: launcherErrorFileTimestamp(occurredAt),
    });
  } catch (logError) {
    nativeConsoleError("写入启动器错误日志失败", logError);
  }
}

function launcherConsoleError(...args: unknown[]) {
  nativeConsoleError(...args);
  const context = typeof args[0] === "string" ? args[0] : "";
  const error = args.length > 1 ? args[args.length - 1] : args[0];
  void recordLauncherError(resolveChineseErrorTitle(context), error, `错误来源：${context || "console.error"}`);
}

function handleUnhandledWindowError(event: ErrorEvent) {
  void recordLauncherError("未捕获的程序错误", event.error || event.message, `脚本：${event.filename}:${event.lineno}:${event.colno}`);
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  void recordLauncherError("未处理的异步错误", event.reason, "错误来源：unhandledrejection");
}

function installLauncherErrorLogging() {
  console.error = launcherConsoleError;
  window.addEventListener("error", handleUnhandledWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
}

function removeLauncherErrorLogging() {
  console.error = nativeConsoleError;
  window.removeEventListener("error", handleUnhandledWindowError);
  window.removeEventListener("unhandledrejection", handleUnhandledRejection);
}

function showCheckResult(message: string) {
  lastCheckMessage.value = message;
  if (isLauncherErrorMessage(message)) {
    void recordLauncherError(launcherErrorTitleFromMessage(message), message, "错误来源：界面提示");
  }
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
    const running = await invoke<boolean>("is_game_running", { installPath: installPath.value });
    gameRunning.value = running;
    gameRunningCheckFailures = 0;
    return running;
  } catch (error) {
    console.warn("Unable to check game process", error);
    // 以前这里直接 return 当前值：只要查询失败过一次，就会永远停在"游戏运行中"。
    // 现在连续失败到阈值就按"没在运行"处理，不让玩家被一个查不动的状态锁死。
    gameRunningCheckFailures += 1;
    if (gameRunningCheckFailures >= 3) {
      gameRunning.value = false;
      return false;
    }
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
  // 状态都清了，本地不再有"没干完的活"：下次点主按钮要重新问装哪儿。
  installPathHasPartialWork.value = false;
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
  if (!isCrossingVoidActive.value || offlineMode.value || launcherState.value !== "ready" || versionCheckPending.value) return;

  versionCheckPending.value = true;
  updateAvailable.value = false;
  try {
    const [localVersion, archive] = await Promise.all([readLocalGameVersion(), fetchGameMetadataArchiveInfo()]);
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
    showCheckResult(`无法打开游戏目录：${formatUnknownError(error)}`);
  }
}

/**
 * 检测到"游戏运行中"、但玩家仍然点了启动时的出路。
 *
 * 2026-09-21 的 bug：进程判定只要出错（或者机器上有个同名进程），按钮就永久锁在"游戏运行中"，
 * 玩家既进不去游戏、也看不到任何解释。现在把具体是哪个进程（PID + 路径）摆出来，
 * 玩家可以选择强制结束它再启动。
 *
 * 返回 true = 可以继续启动；false = 玩家取消或没清干净。
 */
async function resolveRunningGameBeforeLaunch() {
  const processes = await invoke<GameProcessInfo[]>("list_game_processes", { installPath: installPath.value })
    .catch((error) => {
      console.warn("Unable to list game processes", error);
      return [] as GameProcessInfo[];
    });
  const detail = processes.map((item) => `PID ${item.processId} · ${item.path || item.name}`).join("\n");
  const confirmed = await ask(
    `检测到游戏进程还在运行：\n${detail || "（拿不到进程详情）"}\n\n` +
      "如果游戏其实没跑起来（窗口已经没了、或者卡住了），可以强制结束它再启动。",
    { title: "游戏运行中", kind: "warning", okLabel: "强制结束并启动", cancelLabel: "取消" },
  );
  if (!confirmed) return false;

  try {
    const stopped = await invoke<number>("stop_game_processes", { installPath: installPath.value });
    showCheckResult(stopped > 0 ? `已强制结束 ${stopped} 个游戏进程。` : "没有找到可以结束的游戏进程。");
  } catch (error) {
    console.warn("Unable to stop game processes", error);
    showCheckResult(`强制结束游戏进程失败：${formatUnknownError(error)}`);
    return false;
  }

  gameRunning.value = false;
  await new Promise((resolve) => window.setTimeout(resolve, 1000));
  await refreshGameRunningState();
  if (gameRunning.value) {
    showCheckResult("游戏进程还没有退出，稍后再试一次。");
    return false;
  }
  return true;
}

async function launchInstalledGame() {
  showMenu.value = false;
  if (gameLaunchPending.value) return;
  gameLaunchPending.value = true;
  try {
    await refreshGameRunningState();
    if (gameRunning.value) {
      if (!(await resolveRunningGameBeforeLaunch())) return;
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
    const baseline = gamePackageBaseline.value;
    if (typeof payload.doneFiles === "number" && typeof payload.totalFiles === "number") {
      // 文件数也补上基线：暂停→继续不该让"已完成 N/M 个文件"退回去。
      gamePackageFileProgress.value = {
        done: baseline.files + Math.max(0, payload.doneFiles),
        total: baseline.files + Math.max(0, payload.totalFiles),
      };
    }
    // 事件报的是"本轮要下的那些文件"的字节，加上基线才是整包坐标（v1/修复下载的基线是 0）。
    const sessionTotalBytes = payload.totalBytes || 0;
    const totalBytes =
      baseline.bytes + sessionTotalBytes ||
      activeDownloadBytes.value ||
      remoteArchiveBytes.value ||
      fallbackRequiredInstallBytes;
    const nextDownloadedBytes = baseline.bytes + Math.max(0, payload.downloadedBytes || 0);
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

async function ensureChunkImportProgressListener() {
  if (chunkImportProgressUnlisten) return;

  chunkImportProgressUnlisten = await listen<ChunkImportProgressEvent>("game-chunk-import-progress", (event) => {
    if (!gameChunkImportPending.value) return;
    const payload = event.payload;
    repairProgressPercent.value = Math.max(0, Math.min(100, payload.percent || 0));
    repairProgressItems.value = {
      checked: Math.max(0, payload.currentChunk || 0),
      total: Math.max(0, payload.totalChunks || 0),
      repaired: 0,
    };
    verificationCurrentFile.value = payload.fileName || "";
    verificationProcessedBytes.value = Math.max(0, payload.processedBytes || 0);
    verificationTotalBytes.value = Math.max(0, payload.totalBytes || 0);
    verificationCurrentFileBytes.value = Math.max(0, payload.currentChunkBytes || 0);
    verificationCurrentFileTotalBytes.value = Math.max(0, payload.currentChunkTotalBytes || 0);
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
  if (!(await ensureLatestLauncherForNetworkDownload())) return;
  if (gameDownloadActive.value) return;
  if (!isDownloadChannelEnabled(downloadChannelStates.value, downloadSource.value)) {
    showCheckResult(
      downloadChannelNoticeText.value || "当前下载渠道已被关闭，请稍后再试或在设置里换个渠道。",
    );
    return;
  }
  if (!ensureOfficialTrafficAvailable()) return;
  const requestedSource = downloadSource.value;
  activeGameDownloadSource.value = requestedSource;
  // 下载一旦真的开始，"这个路径上有活"就成立了（哪怕只写到一个 `.part`）——
  // 主按钮从此是"继续下载"而不是又问一遍"装哪儿"。
  installPathHasPartialWork.value = true;
  // 文件级基线每轮任务先清零：逐文件链路会在算完差异后填上，v1 归档链路保持 0。
  gamePackageBaseline.value = { bytes: 0, files: 0 };
  downloadTimeEstimator.reset();
  downloadEstimate.value = { status: "calculating" };
  launcherState.value = "downloading";
  downloadPauseRequested.value = false;
  gameDownloadActive.value = true;
  try {
    await ensureDownloadProgressListener();
    if (currentGamePackageConfig()) {
      await downloadGamePackageFiles();
    } else {
      await downloadLegacyGameArchive(requestedSource);
    }
    installStage.value = "downloaded";
    launcherState.value = "downloaded";
    updateAvailable.value = false;
    persistDownloadState("downloaded", "immediate");
  } catch (error) {
    if (!downloadPauseRequested.value && String(error) !== "DOWNLOAD_CANCELLED") {
      console.error("Game download failed", error);
      if (error instanceof GamePackageError) {
        showCheckResult(describeGamePackageError(error));
      }
    }
    launcherState.value = "paused";
    persistDownloadState("paused", "immediate");
  } finally {
    // 准备阶段的文案不能留到下一轮（下一轮开始时会重新设）。
    gamePackagePrepareStage.value = "";
    gameDownloadActive.value = false;
    downloadPauseRequested.value = false;
  }
}

/** v2 切片链路：只服务还没接入下载站的游戏。 */
async function downloadLegacyGameArchive(requestedSource: DownloadSourceKey) {
  const archive = await resolveDownloadArchiveInfo(requestedSource);
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
}

async function installDownloadedGameArchive() {
  if (activeGamePackage.value) {
    await finalizeGamePackageInstall();
    return;
  }
  gameOperationCancelRequested.value = false;
  try {
    const archive = await fetchGameMetadataArchiveInfo();
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
      throw new Error("下载的游戏分片不完整或校验失败。");
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
    showSettings.value = false;
    showInstallConfirm.value = false;
    showMenu.value = false;
    if (cancelled) {
      showCheckResult("已取消安装，下载文件已保留。");
    } else {
      showCheckResult(`安装游戏失败：${formatUnknownError(error)}`);
    }
  } finally {
    downloadPauseRequested.value = false;
    gameOperationCancelRequested.value = false;
  }
}

async function importGameChunks() {
  if (gameChunkImportDisabled.value) return;
  const selected = selectedChunkFolder.value;
  if (!selected) return;
  showGameChunkImportGuide.value = false;

  const previousState = launcherState.value;
  gameChunkImportPending.value = true;
  try {
    const archive = await fetchGameMetadataArchiveInfo();
    await stopActiveDownloadBeforeChunkImport();
    await ensureChunkImportProgressListener();
    resetVerificationProgressDetail();
    repairProgressPercent.value = 0;
    repairProgressItems.value = null;
    launcherState.value = "checking";
    const result = await invoke<{ importedChunks: number; totalChunks: number; complete: boolean }>("import_game_chunks", {
      installPath: installPath.value,
      chunks: archive.chunks ?? [],
      sourcePaths: [selected],
    });
    activeDownloadBytes.value = archive.sizeBytes;
    remoteArchiveBytes.value = archive.sizeBytes;
    downloadedBytes.value = result.complete ? archive.sizeBytes : 0;
    downloadedMb.value = bytesToMb(downloadedBytes.value);
    installStage.value = "downloaded";
    launcherState.value = result.complete ? "downloaded" : "paused";
    persistDownloadState(result.complete ? "downloaded" : "paused", "immediate");
    showSettings.value = false;
    showCheckResult(
      result.complete
        ? `已找到全部 ${result.totalChunks} 个游戏分片，可以开始安装。`
        : `已找到 ${result.importedChunks}/${result.totalChunks} 个游戏分片，请补齐后重试。`,
    );
  } catch (error) {
    console.error("Game chunk import failed", error);
    const fallbackState = gameDownloadActive.value ? previousState : "paused";
    launcherState.value = fallbackState;
    persistDownloadState(fallbackState === "downloaded" ? "downloaded" : "paused", "immediate");
    showSettings.value = false;
    showCheckResult(`安装游戏分片失败：${formatUnknownError(error)}`);
  } finally {
    gameChunkImportPending.value = false;
    selectedChunkFolder.value = "";
  }
}

function openGameChunkImportGuide() {
  if (gameChunkImportDisabled.value) return;
  selectedChunkFolder.value = "";
  showGameChunkImportGuide.value = true;
}

async function chooseGameChunkFolder() {
  const selected = await open({
    multiple: false,
    directory: true,
    title: "选择游戏碎片所在文件夹",
  });
  if (typeof selected === "string") selectedChunkFolder.value = selected;
}

async function openGameChunkSource(url: string) {
  try {
    await openUrl(url);
  } catch (error) {
    console.warn("Unable to open game chunk source", error);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function waitForGameDownloadToStop() {
  const timeoutAt = Date.now() + 30_000;
  while (gameDownloadActive.value && Date.now() < timeoutAt) {
    await wait(100);
  }
  if (gameDownloadActive.value) {
    throw new Error("等待当前下载停止超时，请稍后重试。");
  }
}

async function stopActiveDownloadBeforeChunkImport() {
  if (!gameDownloadActive.value) return;
  downloadPauseRequested.value = true;
  await invoke("pause_game_download");
  await waitForGameDownloadToStop();
}

async function pauseGameDownload() {
  if (launcherState.value !== "downloading") return;
  downloadPauseRequested.value = true;
  launcherState.value = "paused";
  persistDownloadState("paused", "immediate");
  try {
    await invoke("pause_game_download");
  } catch (error) {
    downloadPauseRequested.value = false;
    launcherState.value = "downloading";
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

function requestCancelGameDownload() {
  if (!canCancelGameDownload.value) return;
  confirmAction.value = "cancelDownload";
  showDeleteGameConfirm.value = true;
}

async function cancelGameDownload() {
  if (!canCancelGameDownload.value) return;
  const hadInstalledGame = Boolean(localGameVersion.value);
  downloadCancelPending.value = true;
  downloadPauseRequested.value = true;
  try {
    await invoke("pause_game_download");
    await waitForGameDownloadToStop();
    await invoke("clear_game_download_artifacts", { installPath: installPath.value });
    await clearPersistedDownloadStateForPath(installPath.value);

    // 碎片和记录都清了，这个路径上不再有没干完的活。
    installPathHasPartialWork.value = false;
    gamePackageBaseline.value = { bytes: 0, files: 0 };
    downloadedBytes.value = 0;
    downloadedMb.value = 0;
    activeDownloadBytes.value = null;
    remoteArchiveBytes.value = null;
    activeGameDownloadSource.value = null;
    installStage.value = "downloaded";
    downloadEstimate.value = { status: "calculating" };
    pendingRepairSummary.value = null;
    updateDownloadPending.value = false;
    launcherState.value = hadInstalledGame ? "ready" : "paused";
    if (hadInstalledGame) {
      persistDownloadState("ready", "immediate");
    } else {
      updateAvailable.value = false;
    }

    showDeleteGameConfirm.value = false;
    showSettings.value = false;
    showCheckResult("游戏下载已取消，已清理下载碎片和缓存。");
  } catch (error) {
    console.warn("Unable to cancel game download", error);
    showDeleteGameConfirm.value = false;
    showCheckResult(`取消游戏下载失败：${formatUnknownError(error)}`);
  } finally {
    downloadCancelPending.value = false;
    downloadPauseRequested.value = false;
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
      defaultPath: installDialogMode.value === "migration" ? selectedInstallBasePath.value : installPath.value,
      title: t(installDialogMode.value === "migration" ? "dialog.chooseMigrationPath" : "dialog.chooseInstallPath"),
    });

    if (typeof selected !== "string") return false;

    selectedInstallBasePath.value = selected;
    if (installDialogMode.value === "install") {
      installPath.value = buildGameInstallPath(selected);
    }
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

    const selectedPath = selected.replace(/[\\/]$/, "");
    const nextPath = await invoke<string | null>("find_game_installation", { rootPath: selectedPath });
    if (!nextPath) {
      showCheckResult("重新定位失败：未在所选文件夹中找到完整游戏。");
      return false;
    }

    const previousPath = installPath.value;
    installPath.value = nextPath;
    selectedInstallBasePath.value = inferGameStorageRoot(nextPath);
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

async function migrateInstalledGame() {
  if (gameMigrationPending.value || gameRunning.value || gameSettingsDisabled.value) return;

  installDialogMode.value = "migration";
  selectedInstallBasePath.value = inferGameStorageRoot(installPath.value);
  showInstallConfirm.value = true;
}

async function confirmGameMigration() {
  if (gameMigrationPending.value || gameRunning.value || gameSettingsDisabled.value) return;
  const destinationPath = finalInstallPath.value;
  if (destinationPath.toLowerCase() === installPath.value.replace(/[\\/]$/, "").toLowerCase()) {
    showCheckResult("新的迁移位置与当前游戏位置相同，请先更改路径。");
    return;
  }

  try {
    gameMigrationPending.value = true;
    showInstallConfirm.value = false;
    const previousPath = installPath.value;
    const nextPath = await invoke<string>("move_game_installation", {
      sourcePath: previousPath,
      destinationBasePath: selectedInstallBasePath.value.replace(/[\\/]$/, ""),
    });
    installPath.value = nextPath;
    selectedInstallBasePath.value = inferGameStorageRoot(nextPath);
    await clearPersistedDownloadStateForPath(previousPath);
    persistDownloadState("ready", "immediate");
    await readLocalGameVersion();
    showCheckResult(`游戏已迁移至：${nextPath}`);
    if (!offlineMode.value && !launcherNetworkLocked.value) {
      void checkGameVersion({ manual: true });
    }
  } catch (error) {
    console.warn("Unable to migrate installed game", error);
    showCheckResult(`迁移游戏文件失败：${formatUnknownError(error)}`);
  } finally {
    gameMigrationPending.value = false;
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
  if (launcherState.value === "checking" || launcherState.value === "installing" || launcherState.value === "repairing") return;
  await refreshExternalInstallState();
  if (launcherUpdateConfirmStage.value === "available") {
    await installPendingLauncherUpdate();
    return;
  }
  if (localGamePlayableWhileNetworkLocked.value) {
    await launchInstalledGame();
    return;
  }
  if (launcherNetworkLocked.value) {
    if (launcherUpdateGate.value === "verificationFailed") await checkUpdatesInOrder({ manual: true });
    else showCheckResult("当前启动器仅可使用本地功能，请先更新启动器后再使用网络功能。");
    return;
  }
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

  // 只有"这个路径上从来没动过手"才需要先问装哪儿。
  // 以前这里看的是字节数（`downloadedMb <= 0`）：暂停→继续会把本轮字节清零，
  // 于是继续下载会莫名其妙弹出"选择安装路径"。
  if (!installPathHasPartialWork.value) {
    installDialogMode.value = "install";
    showInstallConfirm.value = true;
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
  if (!hasLauncherUpdate && launcherUpdateGate.value === "ready") {
    await checkGameVersion(options);
  }
}

async function ensureLatestLauncherForNetworkDownload() {
  const updateRequired = await checkLauncherUpdate({ manual: false });
  if (!updateRequired && launcherUpdateGate.value === "ready") return true;
  showCheckResult(
    launcherUpdateGate.value === "verificationFailed"
      ? "无法确认启动器是否为最新版本，已停止游戏下载。"
      : "必须先更新到最新启动器才能下载游戏。",
  );
  return false;
}

async function checkLauncherUpdate(options: { manual?: boolean } = {}): Promise<boolean> {
  if (await isDevelopmentBuild()) {
    launcherUpdateGate.value = "ready";
    if (options.manual) {
      showCheckResult("开发版不参与启动器更新检查。");
    }
    return false;
  }
  if (offlineMode.value) {
    launcherUpdateGate.value = "verificationFailed";
    return false;
  }
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
      launcherUpdateGate.value = "ready";
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
    launcherUpdateGate.value = "updateRequired";
    showCheckResult(`${t("settings.launcherUpdateReady")} ${update.version}`);
    return true;
  } catch (error) {
    console.error("Launcher update check failed", error);
    launcherUpdateStage.value = "failed";
    launcherUpdateGate.value = "verificationFailed";
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
  if (!offlineMode.value && !launcherNetworkLocked.value) {
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
  if (!(await ensureLatestLauncherForNetworkDownload())) return;
  if (launcherState.value !== "repairPending") return;
  // 修复同样要下文件，所以同样受渠道开关约束：被关掉的渠道不能用来补文件。
  if (!isDownloadChannelEnabled(downloadChannelStates.value, downloadSource.value)) {
    showCheckResult(
      downloadChannelNoticeText.value || "当前下载渠道已被关闭，暂时无法补全游戏文件。",
    );
    showSettings.value = true;
    activeSettingsTab.value = "download";
    return;
  }
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
  // 修复走的是归档链路，没有"文件级基线"，清零免得进度数字整体偏移。
  gamePackageBaseline.value = { bytes: 0, files: 0 };
  repairProgressPercent.value = 0;
  repairProgressItems.value = null;
  try {
    await ensureDownloadProgressListener();
    await ensureRepairProgressListener();
    const archive = await resolveDownloadArchiveInfo();
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
  // 游戏删掉了，这个路径上不再有没干完的活。
  installPathHasPartialWork.value = false;
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
  if (confirmAction.value === "cancelDownload") {
    void cancelGameDownload();
    return;
  }
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
const settingsContext = {
  activeSettingsTab,
  autoRepair,
  canCancelGameDownload,
  checkLauncherUpdate,
  closeToTray,
  confirmDangerAction,
  dangerConfirmActionCopy,
  dangerConfirmBody,
  dangerConfirmTitle,
  developerChannels,
  developerChannelsPending,
  developerChannelsStatus,
  developerGameTitle,
  developerGameVersion,
  developerHoldBootSplash,
  developerNoticeContent,
  developerNoticeLevel,
  developerNoticePending,
  developerNoticeStatus,
  developerNoticeTitle,
  developerTaskActive,
  developerTaskPending,
  developerVersionHint,
  developerVersionInput,
  downloadCancelPending,
  downloadChannelNoticeText,
  downloadLimited,
  downloadSource,
  downloadSourceDisabled,
  downloadSourceModel,
  downloadSourceOptions,
  gameChunkImportDisabled,
  gameMigrationPending,
  gameRunning,
  gameSettingsDisabled,
  githubLatencyText,
  githubNetworkWarningText,
  githubProxyText,
  hideAfterGameLaunch,
  installPath,
  launcherLanguage,
  launcherLanguages,
  launcherUpdatePending,
  launcherVersion,
  migrateInstalledGame,
  officialTrafficBlocked,
  openDeveloperProjectFolder,
  openGameChunkImportGuide,
  openGameLogFolder,
  openLauncherLogFolder,
  openLocalGameFiles,
  publishDeveloperDownloadChannels,
  publishDeveloperGamePackage,
  publishDeveloperLauncherPackage,
  publishDeveloperRemoteNotice,
  relocateInstalledGame,
  requestCancelGameDownload,
  requestDeleteGame,
  requestUninstallLauncher,
  restoreAllDeveloperDownloadChannels,
  saveDeveloperLauncherVersion,
  selectedDownloadSourceDescription,
  selectSettingsTab,
  settingsScrollbarFrameStyle,
  settingsScrollbarThumbTop,
  settingsScrollEl,
  settingsScrollSpacer,
  settingsTabs,
  settingsTitle,
  showDeleteGameConfirm,
  showDevPackageConfirm,
  showGameChunkImportAction,
  showSettings,
  showSettingsScrollbar,
  speedLimit,
  t,
  trafficQuota,
  trafficQuotaExpiryText,
  trafficQuotaPercent,
  trafficQuotaRemainingText,
  updateSettingsScrollbar,
};
provide(settingsContextKey, settingsContext);

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
    <img v-if="!gameOverviewVisible && activeGame.backgroundSrc" class="background" :src="activeGame.backgroundSrc" alt="" />
    <div v-if="!gameOverviewVisible" class="cinematic-shade"></div>
    <div class="scanlines"></div>
    <div class="drag-surface"></div>

    <!--
      界面画布：标题栏、各面板、各种弹窗、开机动画全装在这里，按 1200×675 的设计坐标**原样**排版。
      整套界面不做等比缩放（见 styles/shell-backdrop.css 的说明）：窗口比设计尺寸小时裁掉超出部分，
      大时由 100vw/100vh 让贴边的元素各自靠边。背景 / 扫描线留在画布外面满铺。
    -->
    <div class="ui-canvas">

    <header class="titlebar">
      <section v-if="!gameOverviewVisible" class="brand">
        <img v-if="activeGame.brandLogoSrc" class="brand-logo" :src="activeGame.brandLogoSrc" :alt="activeGame.name" />
        <strong v-else class="brand-placeholder">{{ activeGame.name }}</strong>
      </section>

      <nav v-if="isCrossingVoidActive && !gameOverviewVisible" class="quick-links" :aria-label="t('nav.quickLinks')">
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
            class="quick-link-icon"
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
        <div v-if="isCrossingVoidActive && !gameOverviewVisible && (downloadChannelWarningText || showOfficialTrafficWarning || showGithubNetworkWarning)" class="traffic-warning" role="status">
          <CircleAlert :size="18" stroke-width="2.8" />
          <span>{{ downloadChannelWarningText || (showOfficialTrafficWarning ? t("traffic.low") : githubNetworkWarningText) }}</span>
        </div>
      </Transition>

      <section class="window-actions">
        <button
          v-if="isCrossingVoidActive && !gameOverviewVisible"
          class="source-pill"
          type="button"
          @click="showSettings = true; activeSettingsTab = 'download'"
        >
          <span>下载源</span>
          <strong>{{ t(selectedDownloadSource.nameKey) }}</strong>
          <em class="button-tooltip source-tooltip">{{ selectedDownloadSourceDescription }}</em>
        </button>
        <button v-if="!gameOverviewVisible" class="plain-icon" type="button" :aria-label="t('window.settings')" @click="showSettings = true">
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

    <PlatformGameRail
      v-if="showPlatformGameRail"
      :games="platformGames"
      :active-id="activeGameId"
      :overview-active="gameOverviewVisible"
      @select="selectPlatformGame"
      @overview="openPlatformGameOverview"
    />

    <PlatformGameOverview
      v-if="gameOverviewVisible"
      :games="platformGames"
      :preview-id="overviewPreviewGameId"
      @select="activateOverviewGame"
    />

    <PlatformPlaceholderPage
      v-else-if="!isCrossingVoidActive"
      :name="activeGame.name"
      :label="activeGame.shortLabel"
    />

    <section v-if="isCrossingVoidActive && !gameOverviewVisible" class="left-stack" :class="{ collapsed: leftCollapsed }">
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

    <section v-if="isCrossingVoidActive && !gameOverviewVisible" class="right-launcher">
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
              <strong v-if="gamePackageProgressDetail" class="download-size">
                <span>{{ gamePackageProgressDetail }}</span>
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
          <div v-if="compactStatusLine || lastCheckMessage" class="check-result-line">
            {{ lastCheckMessage || statusCopy }}
          </div>
        </Transition>
        <div class="dock-actions" :class="{ 'has-chunk-install': showGameChunkImportAction }">
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
            v-if="showGameChunkImportAction"
            class="primary-action chunk-install-action"
            type="button"
            :disabled="gameChunkImportDisabled"
            @click="openGameChunkImportGuide"
          >
            <PackageOpen :size="34" />
            <span>导入碎片</span>
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
          <LauncherToolMenu
            v-if="showMenu"
            :language="currentLanguage"
            :use-dx11="useDx11"
            :offline-mode="offlineMode"
            :verify-disabled="!canVerifyGameIntegrity || versionCheckPending || gameLaunchPending || gameRunning"
            :check-updates-disabled="!canCheckGameUpdates || offlineMode || versionCheckPending || gameLaunchPending || gameRunning"
            :toggle-disabled="gameLaunchPending || gameRunning"
            :chunk-install-visible="showGameChunkImportAction"
            @open-files="openLocalGameFiles"
            @verify="verifyGameIntegrity"
            @check-updates="checkForUpdates"
            @toggle-offline="toggleOfflineMode"
            @hover-start="cancelToolMenuClose"
            @hover-end="scheduleToolMenuClose"
            @update:use-dx11="useDx11 = $event"
          />
        </Transition>
      </section>
    </section>

    <button
      v-if="isCrossingVoidActive && !gameOverviewVisible"
      class="side-handle"
      :class="{ collapsed: leftCollapsed }"
      type="button"
      :title="leftCollapsed ? t('side.expand') : t('side.collapse')"
      @click="togglePlatformDetails"
    >
      <ChevronLeft :size="30" stroke-width="3.2" />
    </button>

    <section v-if="isCrossingVoidActive && !gameOverviewVisible" class="version-corner" aria-label="version info">
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
        <section class="install-panel" :aria-label="installDialogTitle">
          <button class="install-close" type="button" :aria-label="t('install.close')" @click="showInstallConfirm = false">
            <X :size="23" stroke-width="2.5" />
          </button>
          <h2>{{ installDialogTitle }}</h2>
          <div class="install-path-row">
            <span>{{ finalInstallPath }}</span>
            <button type="button" @click="chooseInstallPath">{{ t("install.change") }}</button>
          </div>
          <div class="install-space-row">
            <span v-if="installDialogMode === 'install' || migrationChangesVolume">{{ t("install.requiredSpace") }}：{{ requiredSpaceCopy }}</span>
            <i v-if="installDialogMode === 'install' || migrationChangesVolume"></i>
            <span :class="{ danger: isInstallSpaceLow }">{{ t("install.availableSpace") }}：{{ availableSpaceCopy }}</span>
          </div>
          <LauncherCheckbox
            v-if="installDialogMode === 'install'"
            v-model="createDesktopShortcut"
            :label="t('install.desktopShortcut')"
            :icon-size="21"
          />
          <button
            class="install-continue"
            type="button"
            :disabled="gameMigrationPending"
            @click="installDialogMode === 'migration' ? confirmGameMigration() : confirmInstallPathAndDownload()"
          >
            {{ installDialogConfirmText }}
          </button>
        </section>
      </div>
    </Transition>

    <Transition name="install-pop">
      <div
        v-if="showGameChunkImportGuide"
        class="install-mask"
        data-no-drag
        @click.self="showGameChunkImportGuide = false"
      >
        <section class="install-panel chunk-import-panel" aria-label="导入游戏碎片">
          <button class="install-close" type="button" aria-label="关闭" @click="showGameChunkImportGuide = false">
            <X :size="23" stroke-width="2.5" />
          </button>
          <h2>导入碎片</h2>
          <p class="chunk-import-description">
            游戏碎片是将完整游戏包拆分后的文件。你可以从网盘或 QQ群下载，全部下载完成后，选择包含全部游戏碎片的文件夹进行校验和安装。
          </p>
          <span class="chunk-import-section-title">获取游戏碎片</span>
          <div class="chunk-source-actions" aria-label="游戏碎片下载渠道">
            <button v-for="source in chunkImportSources" :key="source.name" type="button" @click="openGameChunkSource(source.url)">
              <Download :size="20" />
              <span>{{ source.name }}</span>
            </button>
          </div>
          <span class="chunk-import-section-title">选择碎片文件夹</span>
          <div class="install-path-row chunk-folder-row">
            <span>{{ selectedChunkFolder || "尚未选择游戏碎片文件夹" }}</span>
            <button type="button" @click="chooseGameChunkFolder">选择</button>
          </div>
          <p class="chunk-import-hint">启动器会在所选文件夹及其子文件夹中自动寻找当前版本的游戏碎片。</p>
          <button
            class="install-continue chunk-import-continue"
            type="button"
            :disabled="!selectedChunkFolder || gameChunkImportPending"
            @click="importGameChunks"
          >
            开始导入
          </button>
        </section>
      </div>
    </Transition>

    <Transition name="settings-layer">
      <SettingsPanel v-if="showSettings" />
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

    </div>
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

<style scoped src="./styles/shell-backdrop.css"></style>
<style scoped src="./styles/titlebar.css"></style>
<style scoped src="./styles/news-panel.css"></style>
<style scoped src="./styles/action-dock.css"></style>
<style scoped src="./styles/install-dialogs.css"></style>
<style scoped src="./styles/confirm-dialog.css"></style>
<style scoped src="./styles/remote-notice.css"></style>
