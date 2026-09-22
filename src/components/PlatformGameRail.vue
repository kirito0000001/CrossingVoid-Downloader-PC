<script setup lang="ts">
import { House } from "lucide-vue-next";
import type { PlatformGameDefinition, PlatformGameId } from "../platform/gameCatalog";

defineProps<{
  games: readonly PlatformGameDefinition[];
  activeId: PlatformGameId;
  overviewActive: boolean;
  /** 每一档的下载百分比（正在下载/修复才有）；键是游戏 id。 */
  downloadPercents?: Record<string, number>;
}>();

const emit = defineEmits<{
  select: [id: PlatformGameId];
  overview: [];
}>();
</script>

<template>
  <nav class="platform-game-rail" aria-label="游戏平台">
    <div class="platform-game-list">
      <button
        v-for="game in games"
        :key="game.id"
        class="platform-game-button"
        :class="{ active: !overviewActive && game.id === activeId }"
        type="button"
        :aria-label="game.name"
        :title="game.name"
        @click="emit('select', game.id)"
      >
        <House v-if="game.id === 'tfac-home'" :size="24" stroke-width="2.2" aria-hidden="true" />
        <img v-else-if="game.iconSrc" :src="game.iconSrc" alt="" aria-hidden="true" />
        <span v-else aria-hidden="true">{{ game.shortLabel }}</span>
        <!--
          正在下载的档位在图标底部压一条进度条：玩家切到别的游戏去逛时，
          侧栏还能看出"哪一档在下、到哪了"。下载百分比来自 App.vue 的运行时快照。
        -->
        <b
          v-if="downloadPercents?.[game.id] !== undefined"
          class="platform-game-button__progress"
          :style="{ width: `${downloadPercents[game.id]}%` }"
          aria-hidden="true"
        ></b>
        <i></i>
      </button>
    </div>

    <button
      class="platform-game-button platform-overview-button"
      :class="{ active: overviewActive }"
      type="button"
      aria-label="全部游戏"
      title="全部游戏"
      @click="emit('overview')"
    >
      <span class="platform-overview-icon" aria-hidden="true"></span>
      <i></i>
    </button>
  </nav>
</template>

<style scoped>
.platform-game-rail {
  position: absolute;
  left: 58px;
  top: 92px;
  bottom: 180px;
  z-index: 28;
  width: 62px;
  padding: 8px 7px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(3, 9, 14, 0.88);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(14px);
}

.platform-game-list {
  display: grid;
  gap: 8px;
}

.platform-game-button {
  position: relative;
  width: 46px;
  height: 46px;
  padding: 0;
  overflow: visible;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.045);
  color: rgba(255, 255, 255, 0.76);
  font-size: 17px;
  font-weight: 950;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease, transform 150ms ease;
}

.platform-game-button:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cv-download-progress-end) 46%, transparent);
  background: rgba(255, 255, 255, 0.11);
  color: #fff;
}

.platform-game-button.active {
  border-color: color-mix(in srgb, var(--cv-download-progress-end) 76%, transparent);
  background: color-mix(in srgb, var(--cv-theme-support) 68%, var(--cv-theme-accent) 32%);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.07), 0 8px 22px rgba(0, 0, 0, 0.28);
}

/*
 * 图标要**铺满整格**：以前写死 38×38（比 46 的格子小一圈），四周就露出一道缝。
 * 现在跟着格子的内容盒走，圆角用 inherit 跟按钮一致 ——
 * 按钮自己是 overflow: visible（那个选中指示条要露到格子外面），所以图得自己裁圆角。
 */
.platform-game-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

.platform-game-button i {
  position: absolute;
  left: -8px;
  top: 8px;
  width: 3px;
  height: 30px;
  border-radius: 0 2px 2px 0;
  background: var(--cv-download-progress-end);
  opacity: 0;
}

.platform-game-button.active i {
  opacity: 1;
}

/*
 * 下载进度条压在格子底部：格子自己 overflow: visible（选中指示条要露到外面），
 * 所以这里自己裁圆角，别指望父级裁。
 */
.platform-game-button__progress {
  position: absolute;
  left: 0;
  right: auto;
  bottom: 0;
  height: 3px;
  max-width: 100%;
  border-radius: 0 0 5px 5px;
  background: var(--cv-download-progress-end);
  pointer-events: none;
}

.platform-overview-button {
  flex: 0 0 auto;
}

/*
 * 「更多」图标走的是自己那张 PNG，不是 lucide 的描边图标 —— 所以用遮罩取形状、
 * 用 background-color 上色，颜色跟着主题色走。
 *
 * 主题色不是写死的：运行时按 onSet 清单算好之后写到 :root 的 --cv-theme-accent
 * （见 App.vue 的 loadOnSetColors），拉不到清单时退回 --cv-theme-default-accent。
 * 把颜色印进图片里就跟着变了，所以这里只借它当 mask。
 */
.platform-overview-icon {
  width: 24px;
  height: 24px;
  background-color: var(--cv-theme-accent);
  -webkit-mask: url("../assets/more-app.png") center / contain no-repeat;
  mask: url("../assets/more-app.png") center / contain no-repeat;
}
</style>
