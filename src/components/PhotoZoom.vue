<script setup lang="ts">
import { nextTick, ref } from "vue";
import { X } from "@lucide/vue";

// 叠在照片上的透明按钮，点开后全屏看原图。父元素需要 position: relative。
defineProps<{ src: string; label?: string }>();
const trigger = ref<HTMLButtonElement>();
const dialog = ref<HTMLDialogElement>();
const open = ref(false);
const failed = ref(false);

async function show() {
  // iOS Safari 点按钮不会让按钮获得焦点；先手动聚焦，
  // 关闭大图时焦点回到这里，而不是跳回输入框弹出键盘。
  trigger.value?.focus({ preventScroll: true });
  failed.value = false;
  open.value = true;
  await nextTick();
  dialog.value?.showModal();
}
</script>

<template>
  <span class="photo-zoom">
    <button
      ref="trigger"
      class="zoom-trigger"
      type="button"
      :aria-label="label ? `查看大图：${label}` : '查看大图'"
      @click="show"
    />
    <dialog
      v-if="open"
      ref="dialog"
      class="photo-viewer"
      :aria-label="label || '照片大图'"
      @click="dialog?.close()"
      @close="open = false"
    >
      <p v-if="failed" class="viewer-error">
        原图暂时打不开，可以关闭后重试。
      </p>
      <img
        v-else
        :src="src"
        :alt="label || '照片大图'"
        @error="failed = true"
      />
      <!-- 点击冒泡到 dialog 关闭；按钮主要给读屏和键盘一个明确的关闭入口 -->
      <button
        class="icon-button viewer-close"
        type="button"
        aria-label="关闭大图"
      >
        <X :size="22" />
      </button>
    </dialog>
  </span>
</template>

<style scoped>
.photo-zoom {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.zoom-trigger {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: zoom-in;
}
.zoom-trigger:focus-visible {
  /* 外层 overflow: hidden 会裁掉向外的描边，改为向内 */
  outline-offset: -3px;
}
.photo-viewer {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  border: 0;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
  background: #1d1915;
  color: var(--surface);
  cursor: zoom-out;
}
.photo-viewer::backdrop {
  background: #1d1915;
}
.photo-viewer img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.viewer-error {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
  font-size: 14px;
  text-align: center;
}
.viewer-close {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 10px);
  right: calc(env(safe-area-inset-right) + 10px);
  color: var(--surface);
  background: #1d1915b3;
}
</style>
