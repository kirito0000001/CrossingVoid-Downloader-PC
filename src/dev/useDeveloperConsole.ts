import { computed, ref, watch, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { translate, type LauncherLanguage } from "../i18n/launcherText";
import type {
  DevScriptFinishedEvent,
  DevScriptProgressEvent,
  DeveloperGamePublishContext,
  DeveloperTaskKind,
  RemoteLauncherNotice,
  RemoteNoticeLevel,
} from "../launcherTypes";
import {
  DEV_GAME_ANDROID_PATH_STORAGE_KEY,
  DEV_GAME_TITLE_STORAGE_KEY,
  DEV_GAME_VERSION_STORAGE_KEY,
  DEV_GAME_WINDOWS_PATH_STORAGE_KEY,
  DEV_PACKAGE_PATH_STORAGE_KEY,
} from "../storageKeys";

/**
 * 开发页（打包 / 发布 / 上传 / 远程公告）的全部状态与操作。
 *
 * 只通过 host 拿父组件的少量能力：版本号、语言、提示、错误格式化、
 * 版本比较、远程公告读写，以及任务开始时收起弹窗。
 */
export type DeveloperConsoleHost = {
  launcherVersion: Ref<string>;
  language: Ref<LauncherLanguage>;
  remoteLauncherNotice: Ref<RemoteLauncherNotice | null>;
  notify: (message: string) => void;
  formatError: (error: unknown) => string;
  compareVersions: (left: string, right: string) => number;
  fetchRemoteLauncherNotice: () => Promise<RemoteLauncherNotice>;
  onTaskStart: () => void;
};

export function useDeveloperConsole(host: DeveloperConsoleHost) {
  const {
    launcherVersion,
    language,
    remoteLauncherNotice,
    notify,
    formatError,
    compareVersions,
    fetchRemoteLauncherNotice,
    onTaskStart,
  } = host;

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
  const developerNoticeTitle = ref("");
  const developerNoticeContent = ref("");
  const developerNoticeLevel = ref<RemoteNoticeLevel>("info");
  const developerNoticePending = ref(false);
  const developerNoticeLoaded = ref(false);
  let devScriptProgressUnlisten: UnlistenFn | undefined;
  let devScriptFinishedUnlisten: UnlistenFn | undefined;
  const developerVersionHint = computed(() => translate(language.value, "dev.versionHint").replace("{version}", launcherVersion.value));
  const developerNoticeStatus = computed(() => {
    if (!developerNoticeLoaded.value) return "正在读取线上公告";
    const notice = remoteLauncherNotice.value;
    return notice?.enabled ? `线上公告已启用：${notice.title}` : "当前没有启用的远程公告";
  });
  const developerGameUploadActive = computed(
    () => developerTaskKind.value === "game-windows" || developerTaskKind.value === "game-android",
  );
  const canPauseDeveloperUpload = computed(
    () => developerGameUploadActive.value && developerTaskPending.value && !developerTaskPauseRequested.value,
  );
  const canResumeDeveloperUpload = computed(
    () => developerGameUploadActive.value && developerTaskPaused.value && !developerTaskPending.value,
  );
  function developerTaskStatus(kind: DeveloperTaskKind) {
    if (kind === "game-windows") return "上传 PC 游戏包中";
    if (kind === "game-android") return "上传 Android 游戏包中";
    if (kind === "publish") return "发布启动器中";
    return "打包启动器中";
  }
  const developerTaskActive = computed(() => developerTaskKind.value !== "idle");
  const developerTaskProgressPercent = computed(() => Math.min(100, Math.max(1, Number(developerTaskPercent.value.toFixed(2)))));
  const developerTaskProgressDetail = computed(() => developerTaskMessage.value);
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
      title: translate(language.value, "dev.packageTitle"),
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
    onTaskStart();
    await ensureDevScriptProgressListener();
    await ensureDevScriptFinishedListener();
  }
  
  function finishDeveloperTask(message: string) {
    developerTaskPercent.value = 100;
    developerTaskMessage.value = message;
    developerGamePublishContext.value = null;
    developerTaskPaused.value = false;
    developerTaskPauseRequested.value = false;
    notify(message);
    window.setTimeout(() => {
      developerTaskKind.value = "idle";
      developerTaskPercent.value = 0;
      developerTaskMessage.value = "";
    }, 900);
  }
  
  function failDeveloperTask(message: string) {
    notify(message);
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
      notify("版本号格式不正确，请使用 0.1.1。");
      return;
    }
    if (compareVersions(version, launcherVersion.value) <= 0) {
      notify(developerVersionHint.value);
      return;
    }
  
    developerTaskPending.value = true;
    try {
      const savedVersion = await invoke<string>("dev_set_launcher_version", { version });
      launcherVersion.value = savedVersion;
      developerVersionInput.value = savedVersion;
      notify(`启动器版本号已设置为 ${savedVersion}`);
    } catch (error) {
      console.warn("Unable to set launcher version", error);
      notify(`设置版本号失败：${formatError(error)}`);
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
      failDeveloperTask(`启动器打包失败：${formatError(error)}`);
      developerTaskPending.value = false;
    }
  }
  
  async function publishDeveloperLauncherPackage() {
    if (!isDevToolsAvailable() || developerTaskPending.value) {
      onTaskStart();
      notify("开发工具仅在制作模式可用。");
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
      failDeveloperTask(`发布失败：${formatError(error)}`);
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
      notify("游戏版本号格式不正确，请使用 V0.5.12 或 0.5.12.1-Beta。");
      return;
    }
    if (!releaseTitle || releaseTitle.length > 100 || /[\r\n]/.test(releaseTitle)) {
      notify("游戏发布标题不能为空、不能换行，且不能超过 100 个字符。");
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
      failDeveloperTask(`游戏包发布失败：${formatError(error)}`);
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
      notify(`暂停上传失败：${formatError(error)}`);
    }
  }
  
  async function resumeDeveloperUpload() {
    if (!canResumeDeveloperUpload.value || !developerGamePublishContext.value) return;
    await runDeveloperGamePublish(developerGamePublishContext.value, true);
  }
  
  async function publishDeveloperRemoteNotice(enabled: boolean) {
    if (!isDevToolsAvailable() || developerNoticePending.value) return;
    if (enabled && !developerNoticeTitle.value.trim()) {
      notify("请填写公告标题。");
      return;
    }
    if (enabled && !developerNoticeContent.value.trim()) {
      notify("请填写公告正文。");
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
      notify(result);
    } catch (error) {
      console.error("Unable to publish remote launcher notice", error);
      notify(`远程公告操作失败：${formatError(error)}`);
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
      notify(`打开项目文件夹失败：${formatError(error)}`);
    }
  }

  function disposeDeveloperConsole() {
    if (devScriptProgressUnlisten) {
      devScriptProgressUnlisten();
      devScriptProgressUnlisten = undefined;
    }
    if (devScriptFinishedUnlisten) {
      devScriptFinishedUnlisten();
      devScriptFinishedUnlisten = undefined;
    }
  }

  return {
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
  };
}
