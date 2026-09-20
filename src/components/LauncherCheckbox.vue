<script setup lang="ts">
import { Check } from "lucide-vue-next";

/**
 * 启动器统一的复选框。
 *
 * 外观来自全局的 `src/styles/controls.css`（`.check-row` / `.check-box`），
 * 之前是各处复制粘贴同一段标记，现在收敛成一个组件：偏好设置、开发页的渠道开关
 * 都用它，样式只会有一份。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    label: string;
    disabled?: boolean;
    iconSize?: number;
  }>(),
  {
    disabled: false,
    iconSize: 22,
  },
);

const emit = defineEmits<{ "update:modelValue": [boolean] }>();

function toggle() {
  if (props.disabled) return;
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <button
    class="check-row"
    :class="{ checked: modelValue, disabled }"
    type="button"
    :disabled="disabled"
    :aria-pressed="modelValue"
    @click="toggle"
  >
    <span class="check-box"><Check :size="iconSize" stroke-width="3.2" /></span>
    <strong>{{ label }}</strong>
  </button>
</template>
