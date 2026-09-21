<script setup lang="ts">
import { inject } from "vue";
import {
  ArrowLeft,
  BellOff,
  Check,
  FileText,
  FolderOpen,
  HardDriveDownload,
  Megaphone,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-vue-next";

import LauncherSelect from "./LauncherSelect.vue";
import LauncherCheckbox from "./LauncherCheckbox.vue";
import LauncherRadio from "./LauncherRadio.vue";
import { settingsContextKey } from "../settings/settingsContext";

const settingsContext = inject(settingsContextKey);
if (!settingsContext) {
  throw new Error("SettingsPanel 必须渲染在提供 settingsContext 的组件内");
}

const {
  activeSettingsTab,
  autoRepair,
  autoSourceFallback,
  canCancelGameDownload,
  checkLauncherUpdate,
  closeToTray,
  confirmDangerAction,
  dangerConfirmActionCopy,
  dangerConfirmBody,
  dangerConfirmTitle,
  developerGameTitle,
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
  githubUseSystemProxy,
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
  publishDeveloperGamePackage,
  publishDeveloperDownloadChannels,
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
} = settingsContext;
</script>

<template>
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
                <LauncherRadio
                  v-model="closeToTray"
                  :value="false"
                  :label="t('settings.exitLauncher')"
                />
                <LauncherRadio
                  v-model="closeToTray"
                  :value="true"
                  :label="t('settings.minimizeToTray')"
                />
              </div>

              <div class="setting-block">
                <span class="setting-title">{{ t("settings.display") }}</span>
                <LauncherCheckbox
                  v-model="hideAfterGameLaunch"
                  :label="t('settings.hideAfterGameLaunch')"
                />
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
                <!-- 官方源正常时不再显示任何提示（原来那句"可以在启动器主界面顶部支持一下作者"已去掉）；
                     只有流量不足才说话。下面那条 Github 提示因此要写成 v-else-if，
                     否则官方源正常时也会跟着冒出来。 -->
                <p
                  v-if="downloadSource === 'official' && officialTrafficBlocked"
                  class="traffic-quota__notice low"
                >
                  {{ t("traffic.lowHint") }}
                </p>
                <p v-else-if="downloadSource === 'github'" class="traffic-quota__notice" :class="{ low: Boolean(githubNetworkWarningText) }">
                  {{ githubNetworkWarningText || "Github 网络连接正常。" }}
                </p>
                <p v-if="downloadChannelNoticeText" class="traffic-quota__notice low">
                  {{ downloadChannelNoticeText }}
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
                <LauncherCheckbox
                  v-model="autoSourceFallback"
                  :label="t('settings.autoSourceFallback')"
                />
                <p class="setting-hint">{{ t("settings.autoSourceFallbackHint") }}</p>
                <LauncherCheckbox
                  v-model="githubUseSystemProxy"
                  :label="t('settings.githubUseSystemProxy')"
                />
                <p class="setting-hint">{{ t("settings.githubUseSystemProxyHint") }}</p>
              </div>

               <div class="setting-block">
                 <span class="setting-title">{{ t("settings.downloadSpeed") }}</span>
                <LauncherRadio
                  v-model="downloadLimited"
                  :value="false"
                  :label="t('settings.unlimited')"
                />
                <div class="limit-row">
                  <LauncherRadio
                    v-model="downloadLimited"
                    :value="true"
                    :label="t('settings.limited')"
                  />
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
                <button class="light-action" type="button" @click="openGameLogFolder">
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
                <span class="setting-title">调试</span>
                <LauncherCheckbox v-model="developerHoldBootSplash" label="加载界面常驻（勾上后下次启动开始，调加载界面用）" />
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

              <div class="setting-block developer-channels-block">
                <span class="setting-title">下载渠道开关</span>
                <p class="setting-hint">{{ developerChannelsStatus }}</p>
                <p class="setting-hint">
                  每个渠道独立开关：关掉的渠道玩家侧不能选、也不会被用来下载（省流量）。整站维护请用上面的远程公告。
                </p>
                <div class="developer-channel-list">
                  <div v-for="channel in developerChannels" :key="channel.key" class="developer-channel-row">
                    <LauncherCheckbox v-model="channel.enabled" :label="t(channel.labelKey)" />
                    <input
                      v-model="channel.note"
                      class="path-input developer-channel-note"
                      maxlength="200"
                      placeholder="关闭原因（可留空）"
                    />
                  </div>
                </div>
                <div class="developer-notice-actions">
                  <button class="light-action" type="button" :disabled="developerChannelsPending" @click="publishDeveloperDownloadChannels">
                    <Send :size="22" />
                    <span>{{ developerChannelsPending ? "正在处理" : "发布渠道开关" }}</span>
                  </button>
                  <button class="light-action developer-notice-disable" type="button" :disabled="developerChannelsPending" @click="restoreAllDeveloperDownloadChannels">
                    <RotateCcw :size="22" />
                    <span>全部恢复</span>
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
</template>

<style scoped src="../styles/settings-panel.css"></style>
<style scoped src="../styles/settings-controls.css"></style>
<!-- 确认弹窗那段 DOM 在本组件里（App.vue 只拿走 .confirm-pop-* 过渡类给远程公告用）。 -->
<style scoped src="../styles/confirm-dialog.css"></style>
