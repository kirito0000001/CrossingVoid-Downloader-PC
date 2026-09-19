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
import type { PlatformGameId } from "./platform/gameCatalog";
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
  SETTINGS_SCROLLBAR,
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
const launcherVersion = ref(__APP_VERSION__);
const bundledOnSetManifest = ref<OnSetManifest | null>(null);
const keepBootSplashVisibleForLayout =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("holdBoot");
const bootSplashMinimumDurationMs = 1800;
const bootSplashStartedAt = Date.now();
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
const developerConsole = useDeveloperConsole({
  launcherVersion,
  language: currentLanguage,
  remoteLauncherNotice,
  notify: showCheckResult,
  formatError: formatUnknownError,
  compareVersions,
  fetchRemoteLauncherNotice,
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
  publishDeveloperGamePackage,
  publishDeveloperLauncherPackage,
  publishDeveloperRemoteNotice,
  refreshDeveloperLauncherVersion,
  refreshDeveloperRemoteNotice,
  resumeDeveloperUpload,
  runDeveloperLauncherBuild,
  saveDeveloperLauncherVersion,
} = developerConsole;

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
    bootSplashStatus.value = `正在进入 ${activeGame.value.name}`;
    await Promise.all([waitForBootFonts(1600), preloadBootImages()]);
    return;
  }
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
  const remainingDuration = Math.max(
    0,
    bootSplashMinimumDurationMs - (Date.now() - bootSplashStartedAt),
  );
  bootSplashTimer = window.setTimeout(() => {
    bootSplashVisible.value = false;
    bootSplashTimer = undefined;
  }, remainingDuration + 180);
}

async function initializePlatformPage() {
  const hasLauncherUpdate = await checkLauncherUpdate({ manual: false });
  if (hasLauncherUpdate || launcherUpdateGate.value !== "ready" || !isCrossingVoidActive.value) return;
  await checkGameVersion({ manual: false });
  await Promise.all([
    refreshTrafficQuota(),
    refreshRemoteLauncherNotice(),
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
        if (event.payload && isCrossingVoidActive.value) void refreshExternalInstallState();
      });
      await nextTick();

      bootSplashStatus.value = "准备界面资源";
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
    return activeGameDownloadSourceName.value
      ? `下载游戏中：${activeGameDownloadSourceName.value}`
      : t("status.downloading");
  }
  if (launcherState.value === "downloaded" || hasCompleteDownloadedArchive.value) return t("status.downloaded");
  if (launcherState.value === "ready") return t("status.ready");
  if (updateDownloadPending.value) return t("status.paused");
  if (downloadedMb.value > 0) {
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
  if (!isCrossingVoidActive.value || launcherNetworkLocked.value) return;
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

async function updateRemoteArchiveInfo() {
  remoteArchivePending.value = true;
  try {
    const info = await fetchGameMetadataArchiveInfo();
    remoteArchiveBytes.value = info.sizeBytes || null;
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
  if (!ensureOfficialTrafficAvailable()) return;
  const requestedSource = downloadSource.value;
  activeGameDownloadSource.value = requestedSource;
  downloadTimeEstimator.reset();
  downloadEstimate.value = { status: "calculating" };
  launcherState.value = "downloading";
  downloadPauseRequested.value = false;
  gameDownloadActive.value = true;
  try {
    await ensureDownloadProgressListener();
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
    gameDownloadActive.value = false;
    downloadPauseRequested.value = false;
  }
}

async function installDownloadedGameArchive() {
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

  if (downloadedMb.value <= 0) {
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

    <Transition name="boot-splash">
      <section v-if="bootSplashVisible" class="boot-splash">
        <div class="boot-splash__grain"></div>
        <div class="boot-splash__center">
          <img v-if="activeGame.bootLogoSrc" class="boot-splash__logo" :src="activeGame.bootLogoSrc" :alt="activeGame.name" />
          <span v-else class="boot-splash__placeholder" aria-hidden="true">{{ activeGame.shortLabel }}</span>
          <div class="boot-splash__line">
            <span></span>
          </div>
          <p>{{ bootSplashStatus }}</p>
        </div>
        <strong>Now Loading...</strong>
      </section>
    </Transition>

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
        <div v-if="isCrossingVoidActive && !gameOverviewVisible && (showOfficialTrafficWarning || showGithubNetworkWarning)" class="traffic-warning" role="status">
          <CircleAlert :size="18" stroke-width="2.8" />
          <span>{{ showOfficialTrafficWarning ? t("traffic.low") : githubNetworkWarningText }}</span>
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
          <button
            v-if="installDialogMode === 'install'"
            class="install-option"
            :class="{ checked: createDesktopShortcut }"
            type="button"
            @click="createDesktopShortcut = !createDesktopShortcut"
          >
            <span class="check-box"><Check :size="21" stroke-width="3.2" /></span>
            <strong>{{ t("install.desktopShortcut") }}</strong>
          </button>
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
                <p v-else class="traffic-quota__notice" :class="{ low: Boolean(githubNetworkWarningText) }">
                  {{ githubNetworkWarningText || "Github 网络连接正常。" }}
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
                <div v-else class="traffic-quota github-network-status" :class="{ low: Boolean(githubNetworkWarningText) }">
                  <div class="traffic-quota__header">
                    <span>Github 网络检测</span>
                    <strong>延迟 {{ githubLatencyText }}</strong>
                  </div>
                  <small>代理：{{ githubProxyText }}</small>
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

               <div v-if="canCancelGameDownload || downloadCancelPending" class="setting-block">
                 <span class="setting-title">{{ t("settings.cancelDownload") }}</span>
                 <p class="setting-hint">{{ t("settings.cancelDownloadHint") }}</p>
                 <div class="game-actions">
                   <button
                     class="danger-action"
                     type="button"
                     :disabled="downloadCancelPending"
                     @click="requestCancelGameDownload"
                   >
                     <X :size="22" />
                     <span>{{ downloadCancelPending ? t("action.cancelling") : t("settings.cancelDownload") }}</span>
                   </button>
                 </div>
               </div>

              <div v-if="showGameChunkImportAction" class="setting-block">
                 <span class="setting-title">本地游戏碎片</span>
                 <p class="setting-hint">导入从网盘、QQ群或其他位置获取的当前版本游戏碎片。</p>
                 <button class="light-action" type="button" :disabled="gameChunkImportDisabled" @click="openGameChunkImportGuide">
                   <HardDriveDownload :size="22" />
                   <span>导入碎片</span>
                 </button>
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
                <button type="button" :disabled="gameMigrationPending || gameRunning || gameSettingsDisabled" @click="migrateInstalledGame">
                  <FolderOpen :size="22" />
                  <span>{{ gameMigrationPending ? "正在迁移游戏文件" : t("settings.migrateGame") }}</span>
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
              :aria-label="dangerConfirmTitle"
            >
              <h3>{{ dangerConfirmTitle }}</h3>
              <p>{{ dangerConfirmBody }}</p>
              <div class="confirm-actions">
                <button class="confirm-delete" type="button" :disabled="downloadCancelPending" @click="confirmDangerAction">
                  {{ dangerConfirmActionCopy }}
                </button>
                <button class="confirm-cancel" type="button" :disabled="downloadCancelPending" @click="showDeleteGameConfirm = false">
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

<style scoped src="./styles/shell-backdrop.css"></style>
<style scoped src="./styles/titlebar.css"></style>
<style scoped src="./styles/news-panel.css"></style>
<style scoped src="./styles/action-dock.css"></style>
<style scoped src="./styles/install-dialogs.css"></style>
<style scoped src="./styles/settings-panel.css"></style>
<style scoped src="./styles/confirm-dialog.css"></style>
<style scoped src="./styles/settings-controls.css"></style>
