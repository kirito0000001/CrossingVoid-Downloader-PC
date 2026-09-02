<script setup lang="ts">
import { Grid2X2, House } from "lucide-vue-next";
import type { PlatformGameDefinition, PlatformGameId } from "../platform/gameCatalog";

defineProps<{
  games: readonly PlatformGameDefinition[];
  activeId: PlatformGameId;
  overviewActive: boolean;
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
      <Grid2X2 :size="24" stroke-width="2.2" aria-hidden="true" />
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

.platform-game-button img {
  width: 38px;
  height: 38px;
  object-fit: contain;
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

.platform-overview-button {
  flex: 0 0 auto;
}
</style>
