<script setup lang="ts">
/**
 * 启动器统一的单选框行。
 *
 * 和 `LauncherCheckbox` 同一套路：外观来自全局的 `src/styles/controls.css`
 * （`.radio-row` / `.radio-dot`），以前设置页里是到处手写同一段标记，
 * 现在收敛成一个组件 —— 圆点和悬停变色的规则只会有一份。
 *
 * 用法和原生 radio 一样：`v-model` 绑布尔值，每个选项给一个 `:value`。
 */
const props = defineProps<{
  modelValue: boolean;
  value: boolean;
  label: string;
}>();

const emit = defineEmits<{ "update:modelValue": [boolean] }>();

function select() {
  emit("update:modelValue", props.value);
}
</script>

<template>
  <button
    class="radio-row"
    :class="{ checked: modelValue === value }"
    type="button"
    @click="select"
  >
    <span class="radio-dot"></span>
    <strong>{{ label }}</strong>
  </button>
</template>
