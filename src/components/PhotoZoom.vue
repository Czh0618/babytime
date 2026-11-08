<script setup lang="ts">
import { nextTick, ref } from "vue";
import { X } from "@lucide/vue";
import type { MediaAsset } from "../types";
import { ensureRemoteOriginal } from "../lib/media-sync";

// 叠在照片上的透明按钮，点开后全屏看原图。父元素需要 position: relative。
// P7.2：本机没有原片时，点开的同时去自己的服务器按需取回并缓存。
const props = defineProps<{ src?: string; media?: MediaAsset; label?: string }>();
const trigger = ref<HTMLButtonElement>();
const dialog = ref<HTMLDialogElement>();
const open = ref(false);
const failed = ref(false);
const loading = ref(false);
const activeSrc = ref("");

async function show() {
  // iOS Safari 点按钮不会让按钮获得焦点；先手动聚焦，
  // 关闭大图时焦点回到这里，而不是跳回输入框弹出键盘。
  trigger.value?.focus({ preventScroll: true });
  failed.value = false;
  activeSrc.value = props.src ?? "";
  open.value = true;
  await nextTick();
  dialog.value?.showModal();
  if (props.media && !props.media.url) {
    loading.value = true;
    try {
      activeSrc.value = await ensureRemoteOriginal(props.media);
    } catch {
      // 取不到原片就退回缩略图，仍然可以看，不弹错误打断操作。
    } finally {
      loading.value = false;
    }
  }
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
      <p v-else-if="loading" class="viewer-hint" role="status">
        正在取回原图…
      </p>
      <img
        v-else-if="activeSrc"
        :src="activeSrc"
        :alt="label || '照片大图'"
        @error="failed = true"
      />
      <p v-else class="viewer-error">这张照片暂时没有可显示的画面。</p>
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
.viewer-error,
.viewer-hint {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
  font-size: 14px;
  text-align: center;
  margin: 0;
}
.viewer-close {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 10px);
  right: calc(env(safe-area-inset-right) + 10px);
  color: var(--surface);
  background: #1d1915b3;
}
</style>
