import type { InjectionKey } from "vue";

/**
 * 设置弹窗需要的全部状态与动作。
 *
 * 成员由 App.vue 的 setup 作用域 provide 出去，SettingsPanel 解构后
 * 在模板里直接用裸名字引用；解构出来的 ref 仍然是 ref，模板赋值会写穿到 .value。
 */
export type SettingsContext = {
  activeSettingsTab: any;
  autoRepair: any;
  canCancelGameDownload: any;
  checkLauncherUpdate: any;
  closeToTray: any;
  confirmDangerAction: any;
  dangerConfirmActionCopy: any;
  dangerConfirmBody: any;
  dangerConfirmTitle: any;
  developerChannels: any;
  developerChannelsPending: any;
  developerChannelsStatus: any;
  developerGameTitle: any;
  developerGameVersion: any;
  developerNoticeContent: any;
  developerNoticeLevel: any;
  developerNoticePending: any;
  developerNoticeStatus: any;
  developerNoticeTitle: any;
  developerTaskActive: any;
  developerTaskPending: any;
  developerVersionHint: any;
  developerVersionInput: any;
  downloadCancelPending: any;
  downloadChannelNoticeText: any;
  downloadLimited: any;
  downloadSource: any;
  downloadSourceDisabled: any;
  downloadSourceModel: any;
  downloadSourceOptions: any;
  gameChunkImportDisabled: any;
  gameMigrationPending: any;
  gameRunning: any;
  gameSettingsDisabled: any;
  githubLatencyText: any;
  githubNetworkWarningText: any;
  githubProxyText: any;
  hideAfterGameLaunch: any;
  installPath: any;
  launcherLanguage: any;
  launcherLanguages: any;
  launcherUpdatePending: any;
  launcherVersion: any;
  migrateInstalledGame: any;
  officialTrafficBlocked: any;
  openDeveloperProjectFolder: any;
  openGameChunkImportGuide: any;
  openLauncherLogFolder: any;
  openLocalGameFiles: any;
  publishDeveloperDownloadChannels: any;
  publishDeveloperGamePackage: any;
  publishDeveloperLauncherPackage: any;
  publishDeveloperRemoteNotice: any;
  relocateInstalledGame: any;
  requestCancelGameDownload: any;
  requestDeleteGame: any;
  requestUninstallLauncher: any;
  restoreAllDeveloperDownloadChannels: any;
  saveDeveloperLauncherVersion: any;
  selectedDownloadSourceDescription: any;
  selectSettingsTab: any;
  settingsScrollbarFrameStyle: any;
  settingsScrollbarThumbTop: any;
  settingsScrollEl: any;
  settingsScrollSpacer: any;
  settingsTabs: any;
  settingsTitle: any;
  showDeleteGameConfirm: any;
  showDevPackageConfirm: any;
  showGameChunkImportAction: any;
  showSettings: any;
  showSettingsScrollbar: any;
  speedLimit: any;
  t: any;
  trafficQuota: any;
  trafficQuotaExpiryText: any;
  trafficQuotaPercent: any;
  trafficQuotaRemainingText: any;
  updateSettingsScrollbar: any;
};

export const settingsContextKey: InjectionKey<SettingsContext> = Symbol("launcher-settings");
