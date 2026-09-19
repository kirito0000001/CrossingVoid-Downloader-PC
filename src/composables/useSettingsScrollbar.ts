import { computed, nextTick, onBeforeUnmount, ref, type Ref } from "vue";

import { SETTINGS_SCROLLBAR } from "../launcherData";
import type { SettingsTab } from "../launcherTypes";

/**
 * 设置弹窗的自绘滚动条：把内容溢出量换算成轨道高度和滑块位置。
 *
 * 与设置弹窗的 DOM 绑在一起，所以只接收“弹窗是否打开”和“当前页签”。
 */
export function useSettingsScrollbar(options: {
  visible: Ref<boolean>;
  activeTab: Ref<SettingsTab>;
}) {
  const { visible, activeTab } = options;

  const settingsScrollEl = ref<HTMLElement | null>(null);
  const settingsContentOverflowing = ref(false);
  const settingsScrollSpacer = ref(0);
  const settingsScrollbarThumbTop = ref(0);
  let settingsScrollbarFrame: number | undefined;
  
  const settingsScrollbarFrameStyle = computed(() => ({
    top: `${SETTINGS_SCROLLBAR.railTop}px`,
    bottom: `${SETTINGS_SCROLLBAR.railBottom}px`,
  }));
  const showSettingsScrollbar = computed(() => Boolean(visible.value && settingsContentOverflowing.value));
  
  function updateSettingsScrollbar() {
    const scrollEl = settingsScrollEl.value;
    const pageEl =
      scrollEl?.querySelector<HTMLElement>(`[data-settings-page="${activeTab.value}"]`) ??
      scrollEl?.querySelector<HTMLElement>(".settings-page");
    const modalEl = scrollEl?.closest<HTMLElement>(".settings-modal");
    const modalRect = modalEl?.getBoundingClientRect();
    const pageRect = pageEl?.getBoundingClientRect();
    const visualViewportHeight = scrollEl
      ? Math.max(0, scrollEl.clientHeight - (SETTINGS_SCROLLBAR.viewportBottomInset - SETTINGS_SCROLLBAR.frameBottomOffset))
      : 0;
    const overflowAmount =
      pageRect && visualViewportHeight
        ? Math.max(0, Math.ceil(pageRect.height - visualViewportHeight))
        : 0;
    const visuallyOverflowing = Boolean(
      overflowAmount > 0,
    );
    const nativeOverflowing = Boolean(scrollEl && pageEl && pageEl.scrollHeight > scrollEl.clientHeight + 2);
    const shouldShowVisualScrollbar = visuallyOverflowing || nativeOverflowing;
    settingsContentOverflowing.value = Boolean(visible.value && scrollEl && shouldShowVisualScrollbar);
    settingsScrollSpacer.value = visuallyOverflowing ? overflowAmount + SETTINGS_SCROLLBAR.extraScrollSpace : 0;
    const maxScroll = scrollEl ? scrollEl.scrollHeight - scrollEl.clientHeight : 0;
    const railTravel = modalRect
      ? Math.max(0, modalRect.height - SETTINGS_SCROLLBAR.railTop - SETTINGS_SCROLLBAR.railBottom) *
        (1 - SETTINGS_SCROLLBAR.thumbVisibleRatio)
      : 0;
    settingsScrollbarThumbTop.value =
      showSettingsScrollbar.value && maxScroll > 0
        ? Math.min(railTravel, Math.max(0, scrollEl!.scrollTop / maxScroll) * railTravel)
        : 0;
  }
  
  function resetSettingsScrollbar() {
    settingsScrollSpacer.value = 0;
    settingsScrollbarThumbTop.value = 0;
    settingsContentOverflowing.value = false;
  }
  
  function scheduleSettingsScrollbarUpdate() {
    if (settingsScrollbarFrame !== undefined) {
      window.cancelAnimationFrame(settingsScrollbarFrame);
    }
    void nextTick(() => {
      settingsScrollbarFrame = window.requestAnimationFrame(() => {
        settingsScrollbarFrame = undefined;
        updateSettingsScrollbar();
      });
    });
  }

  onBeforeUnmount(() => {
    if (settingsScrollbarFrame !== undefined) {
      window.cancelAnimationFrame(settingsScrollbarFrame);
      settingsScrollbarFrame = undefined;
    }
  });

  return {
    settingsScrollEl,
    showSettingsScrollbar,
    settingsScrollbarFrameStyle,
    settingsScrollbarThumbTop,
    settingsScrollSpacer,
    updateSettingsScrollbar,
    resetSettingsScrollbar,
    scheduleSettingsScrollbarUpdate,
  };
}
