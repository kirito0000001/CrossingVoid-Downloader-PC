<script setup lang="ts">
defineProps<{
  name: string;
  label: string;
}>();
</script>

<template>
  <section class="platform-placeholder-page" :aria-label="name">
    <span>{{ label }}</span>
    <h1>{{ name }}</h1>
    <p>页面资源尚未接入</p>
  </section>
</template>

<style scoped>
.platform-placeholder-page {
  position: absolute;
  inset: 72px 0 0;
  z-index: 2;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  background: rgba(2, 7, 11, 0.72);
  text-align: center;
}

.platform-placeholder-page > span {
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 6px;
  color: var(--cv-accent-title);
  font-size: 28px;
  font-weight: 950;
}

.platform-placeholder-page h1 {
  margin: 0;
  color: rgba(255, 255, 255, 0.95);
  font-size: 34px;
  letter-spacing: 0;
}

.platform-placeholder-page p {
  margin: 0;
  color: rgba(255, 255, 255, 0.52);
  font-size: 15px;
  font-weight: 800;
}
</style>
