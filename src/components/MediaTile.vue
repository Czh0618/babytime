<script setup lang="ts">
import { Image as ImageIcon, Film, NotebookPen } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { MediaAsset } from "../types";
import { durationLabel } from "../domain/date";
import PhotoZoom from "./PhotoZoom.vue";

const props = withDefaults(
  defineProps<{
    media?: MediaAsset;
    variant?: "thumb" | "cover" | "wide";
    label?: string;
    /** 点开看大图；本身在按钮里的缩略图（如今天列表）不要开，避免按钮嵌套。 */
    zoomable?: boolean;
  }>(),
  { variant: "thumb", label: "" },
);
const failed = ref(false);
// 能直接显示的原图：示例素材没有 url，浏览器解不了的格式 previewable 为 false。
const photoUrl = computed(() =>
  props.media?.kind === "image" && props.media.previewable !== false
    ? props.media.url
    : undefined,
);
watch(
  () => props.media?.id,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div
    :class="[
      'media-tile',
      `media-${variant}`,
      `theme-${media?.theme || 'sand'}`,
      { 'is-demo': media?.demo },
    ]"
    :aria-label="label || '素材预览'"
  >
    <img
      v-if="!failed && (media?.thumbnailUrl || photoUrl)"
      :src="media?.thumbnailUrl || photoUrl"
      :alt="label || media?.name"
      loading="lazy"
      @error="failed = true"
    />
    <div v-else class="media-placeholder" aria-hidden="true">
      <component
        :is="!media ? NotebookPen : media.kind === 'video' ? Film : ImageIcon"
        :size="variant === 'thumb' ? 23 : 30"
        :stroke-width="1.3"
      />
      <span v-if="variant !== 'thumb' && !media?.demo">{{
        media?.url
          ? "原片已保存"
          : media
            ? "原片不在这台设备"
            : "一段写下来的时光"
      }}</span>
    </div>
    <span
      v-if="media?.kind === 'video' && media.duration"
      class="media-duration"
      >{{ durationLabel(media.duration) }}</span
    >
    <span v-if="media?.demo && variant !== 'thumb'" class="media-demo"
      >画面示意</span
    >
    <PhotoZoom
      v-if="zoomable && photoUrl"
      :src="photoUrl"
      :label="label || media?.name"
    />
  </div>
</template>

<style scoped>
.media-tile {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: var(--tint);
  color: var(--accent);
  flex: none;
  isolation: isolate;
}
.media-thumb {
  width: 68px;
  height: 80px;
}
.media-cover {
  width: 100%;
  aspect-ratio: 16/10;
}
.media-wide {
  width: 100%;
  aspect-ratio: 4/3;
}
.media-cover.is-demo {
  aspect-ratio: 2/1;
}
.media-tile img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  inset: 0;
}
.theme-sage {
  background: var(--sage);
  color: var(--sage-ink);
}
.theme-rose {
  background: var(--rose);
  color: var(--rose-ink);
}
.media-placeholder {
  display: grid;
  justify-items: center;
  gap: 13px;
  opacity: 0.78;
  font-size: 12px;
  letter-spacing: 1px;
}
.media-cover::before,
.media-wide::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 58%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.055;
  right: -10%;
  top: -15%;
}
.media-duration {
  position: absolute;
  right: 9px;
  bottom: 9px;
  padding: 2px 6px;
  border-radius: 5px;
  color: #fff;
  background: #302820b8;
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}
.media-demo {
  position: absolute;
  left: 12px;
  top: 10px;
  font-size: var(--font-xs);
  opacity: 0.7;
}
</style>
