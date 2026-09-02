<script setup lang="ts">
import { computed } from "vue";
import { House } from "lucide-vue-next";
import type { PlatformGameDefinition, PlatformGameId } from "../platform/gameCatalog";

const props = defineProps<{
  games: readonly PlatformGameDefinition[];
  previewId: PlatformGameId;
}>();

const emit = defineEmits<{
  select: [id: PlatformGameId];
}>();

const previewGame = computed(
  () => props.games.find((game) => game.id === props.previewId) ?? props.games[0],
);

function handleWheel(event: WheelEvent) {
  const track = event.currentTarget;
  if (!(track instanceof HTMLElement) || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  track.scrollBy({ left: event.deltaY, behavior: "smooth" });
}
</script>

<template>
  <section class="platform-game-overview" aria-label="全部游戏">
    <img
      v-if="previewGame.backgroundSrc"
      :key="previewGame.id"
      class="platform-game-overview__background"
      :src="previewGame.backgroundSrc"
      alt=""
      aria-hidden="true"
    />
    <header class="platform-game-overview__header">
      <span>{{ previewGame.englishName }}</span>
      <h1>{{ previewGame.name }}</h1>
      <p>{{ previewGame.description }}</p>
    </header>

    <div
      class="platform-game-covers"
      :class="{ 'is-scrollable': games.length > 6 }"
      @wheel="handleWheel"
    >
      <div class="platform-game-covers__track">
        <button
          v-for="game in games"
          :key="game.id"
          class="platform-game-cover"
          :class="{ active: game.id === previewId, 'has-background': game.backgroundSrc }"
          type="button"
          @click="emit('select', game.id)"
        >
          <img v-if="game.backgroundSrc" :src="game.backgroundSrc" alt="" aria-hidden="true" />
          <span v-else class="platform-game-cover__placeholder" aria-hidden="true">{{ game.shortLabel }}</span>
          <span v-if="game.id === previewId" class="platform-game-cover__selected" aria-hidden="true">
            <img v-if="game.iconSrc" :src="game.iconSrc" alt="" />
            <House v-else-if="game.id === 'tfac-home'" :size="30" stroke-width="2.1" />
            <b v-else>{{ game.shortLabel }}</b>
            <em>查看详情</em>
          </span>
          <strong v-else>{{ game.name }}</strong>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.platform-game-overview {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 3;
  overflow: hidden;
  background: #10161b;
}

.platform-game-overview__background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: overview-background-in 260ms ease-out;
}

.platform-game-overview__background::after {
  content: "";
}

.platform-game-overview::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(3, 7, 10, 0.46);
  pointer-events: none;
}

.platform-game-overview__header {
  position: absolute;
  left: 8%;
  top: 15%;
  z-index: 1;
  max-width: 430px;
}

.platform-game-overview__header span {
  color: #e7bd63;
  font-family: "UnispaceCV", sans-serif;
  font-size: 14px;
  font-weight: 900;
}

.platform-game-overview__header h1 {
  margin: 7px 0 0;
  color: #fff;
  font-size: 30px;
  letter-spacing: 0;
}

.platform-game-overview__header p {
  max-width: 360px;
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.74);
  font-size: 15px;
  font-weight: 750;
  line-height: 1.5;
}

.platform-game-covers {
  position: absolute;
  left: 50%;
  top: 80vh;
  bottom: auto;
  z-index: 1;
  width: min(900px, calc(100% - 64px));
  height: 92px;
  transform: translateX(-50%);
  overflow: hidden;
  scrollbar-width: none;
}

.platform-game-covers__track {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.platform-game-covers.is-scrollable {
  width: calc(100% - 64px);
  overflow-x: auto;
}

.platform-game-covers.is-scrollable .platform-game-covers__track {
  width: max-content;
  display: flex;
}

.platform-game-cover {
  position: relative;
  width: 100%;
  height: 84px;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: rgba(8, 14, 18, 0.88);
  color: #fff;
  text-align: left;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.platform-game-covers.is-scrollable .platform-game-cover {
  width: 160px;
  flex: 0 0 160px;
}

.platform-game-cover.has-background {
  background: transparent;
}

.platform-game-cover:hover {
  transform: translateY(-3px);
  border-color: rgba(255, 255, 255, 0.5);
}

.platform-game-cover.active {
  border-color: #e7c86e;
  box-shadow: 0 0 0 2px rgba(231, 200, 110, 0.42), 0 12px 30px rgba(0, 0, 0, 0.34);
}

.platform-game-cover > img,
.platform-game-cover__placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.platform-game-cover > img {
  object-fit: cover;
}

.platform-game-cover__placeholder {
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.18);
  font-family: "SJBangshu", sans-serif;
  font-size: 42px;
}

.platform-game-cover strong {
  position: absolute;
  left: 12px;
  right: 10px;
  bottom: 11px;
  z-index: 1;
  overflow: hidden;
  font-size: 14px;
  font-weight: 950;
  text-overflow: ellipsis;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
}

.platform-game-cover__selected {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  display: grid;
  justify-items: center;
  gap: 4px;
  color: #fff;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.88));
}

.platform-game-cover__selected img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.platform-game-cover__selected b {
  font-size: 22px;
  line-height: 1;
}

.platform-game-cover__selected em {
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
  white-space: nowrap;
}

@keyframes overview-background-in {
  from { opacity: 0.72; }
  to { opacity: 1; }
}
</style>
