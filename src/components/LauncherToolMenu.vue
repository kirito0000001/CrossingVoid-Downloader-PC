<script setup lang="ts">
import { Check, FolderOpen, RefreshCw, Wrench } from "lucide-vue-next";

import { translate, type LauncherLanguage } from "../i18n/launcherText";

const props = defineProps<{
  language: LauncherLanguage;
  useDx11: boolean;
  offlineMode: boolean;
  verifyDisabled: boolean;
  checkUpdatesDisabled: boolean;
  toggleDisabled: boolean;
  chunkInstallVisible: boolean;
}>();

const emit = defineEmits<{
  openFiles: [];
  verify: [];
  checkUpdates: [];
  toggleOffline: [];
  hoverStart: [];
  hoverEnd: [];
  "update:useDx11": [value: boolean];
}>();
</script>

<template>
  <div
    class="tool-menu"
    :class="{ 'has-chunk-install': props.chunkInstallVisible }"
    @mouseenter="emit('hoverStart')"
    @mouseleave="emit('hoverEnd')"
  >
    <button type="button" @click="emit('openFiles')">
      <FolderOpen :size="20" />
      <span>{{ translate(props.language, "tool.openLocalFiles") }}</span>
    </button>
    <button
      type="button"
      :disabled="props.verifyDisabled"
      @click="emit('verify')"
    >
      <Wrench :size="20" />
      <span>{{ translate(props.language, "tool.verifyIntegrity") }}</span>
    </button>
    <button
      type="button"
      :disabled="props.checkUpdatesDisabled"
      @click="emit('checkUpdates')"
    >
      <RefreshCw :size="20" />
      <span>{{ translate(props.language, "tool.checkUpdates") }}</span>
    </button>
    <button
      type="button"
      class="tool-menu-toggle"
      :class="{ active: props.useDx11 }"
      :disabled="props.toggleDisabled"
      @click="emit('update:useDx11', !props.useDx11)"
    >
      <span class="menu-check" aria-hidden="true">
        <Check v-if="props.useDx11" :size="14" />
      </span>
      <span>{{ translate(props.language, "tool.useDx11") }}</span>
    </button>
    <button
      type="button"
      class="tool-menu-toggle"
      :class="{ active: props.offlineMode }"
      @click="emit('toggleOffline')"
    >
      <span class="menu-check" aria-hidden="true">
        <Check v-if="props.offlineMode" :size="14" />
      </span>
      <span>{{ translate(props.language, "tool.offlineMode") }}</span>
    </button>
  </div>
</template>

<style scoped>
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

.tool-menu.has-chunk-install {
  right: 402px;
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
</style>
