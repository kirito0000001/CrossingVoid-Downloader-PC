<script setup lang="ts">
import { ref, watch } from "vue";
import { ChevronLeft } from "lucide-vue-next";

const props = defineProps<{
  modelValue: string;
  options: readonly string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const open = ref(false);

function toggleOpen() {
  if (props.disabled) return;
  open.value = !open.value;
}

function selectOption(option: string) {
  if (props.disabled) return;
  emit("update:modelValue", option);
  open.value = false;
}

watch(() => props.disabled, (disabled) => {
  if (disabled) open.value = false;
});
</script>

<template>
  <div class="launcher-select" :class="{ open, disabled }">
    <button class="launcher-select__trigger" type="button" :disabled="disabled" @click="toggleOpen">
      <span>{{ modelValue }}</span>
      <ChevronLeft :size="24" stroke-width="3" aria-hidden="true" />
    </button>
    <Transition name="launcher-select-menu">
      <div v-if="open" class="launcher-select__menu">
        <button
          v-for="option in options"
          :key="option"
          class="launcher-select__option"
          :class="{ active: modelValue === option }"
          type="button"
          @click="selectOption(option)"
        >
          {{ option }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.launcher-select {
  position: relative;
  z-index: 35;
  width: 100%;
  max-width: 470px;
  height: 52px;
  border: 1px solid color-mix(in srgb, var(--cv-accent-soft) 42%, transparent);
  border-radius: 5px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--cv-accent-soft) 8%, transparent),
      color-mix(in srgb, var(--cv-bg-deep) 18%, transparent)
    ),
    color-mix(in srgb, var(--cv-theme-support) 76%, transparent);
  color: rgba(255, 255, 255, 0.92);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 10px 24px rgba(0, 0, 0, 0.22);
}

.launcher-select.open {
  border-color: color-mix(in srgb, var(--cv-accent-soft) 72%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--cv-theme-accent) 16%, transparent),
      color-mix(in srgb, var(--cv-bg-deep) 22%, transparent)
    ),
    color-mix(in srgb, var(--cv-theme-support) 90%, transparent);
}

.launcher-select.disabled {
  cursor: not-allowed;
  opacity: 0.46;
  filter: grayscale(0.35);
}

.launcher-select__trigger:disabled {
  cursor: not-allowed;
}

.launcher-select__trigger {
  width: 100%;
  height: 100%;
  padding: 0 16px 0 18px;
  border: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  font-size: 18px;
  font-weight: 950;
  text-align: left;
}

.launcher-select__trigger svg {
  color: var(--cv-theme-accent);
  transform: rotate(-90deg);
  transition: transform 160ms ease;
}

.launcher-select.open .launcher-select__trigger svg {
  transform: rotate(90deg);
}

.launcher-select__menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  overflow: hidden;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--cv-accent-soft) 38%, transparent);
  border-radius: 5px;
  transform-origin: top center;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--cv-bg-surface) 98%, transparent),
      color-mix(in srgb, var(--cv-bg-deep) 98%, transparent)
    ),
    color-mix(in srgb, var(--cv-theme-support) 98%, transparent);
  box-shadow:
    0 18px 34px rgba(0, 0, 0, 0.38),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.launcher-select-menu-enter-active,
.launcher-select-menu-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease,
    max-height 170ms ease;
}

.launcher-select-menu-enter-from,
.launcher-select-menu-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-6px) scaleY(0.92);
}

.launcher-select-menu-enter-to,
.launcher-select-menu-leave-from {
  opacity: 1;
  max-height: 190px;
  transform: translateY(0) scaleY(1);
}

.launcher-select__option {
  width: 100%;
  height: 39px;
  margin-bottom: 4px;
  padding: 0 13px;
  border: 0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  background: transparent;
  color: rgba(255, 255, 255, 0.76);
  font-size: 17px;
  font-weight: 900;
  text-align: left;
}

.launcher-select__option:last-child {
  margin-bottom: 0;
}

.launcher-select__option:hover,
.launcher-select__option.active {
  color: var(--cv-accent-soft);
  background:
    radial-gradient(circle at 96% 50%, color-mix(in srgb, var(--cv-theme-accent) 24%, transparent), transparent 18%),
    rgba(255, 255, 255, 0.08);
}
</style>
