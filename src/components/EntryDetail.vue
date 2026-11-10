<script setup lang="ts">
import { computed, ref } from "vue";
import { Heart, Pencil, Trash2 } from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";
import MediaTile from "./MediaTile.vue";
import PhotoZoom from "./PhotoZoom.vue";
import type { GrowthEntry, MediaAsset } from "../types";
import { formatDate, formatTime } from "../domain/date";
import { describeCare } from "../domain/care-records";
import { CARE_LABELS } from "../domain/care-types";
import { clipAction } from "../domain/clip";
/** P7.1：详情里按顺序横滑看全部照片，视频仍只播一个。 */
const props = defineProps<{
  entry: GrowthEntry;
  media?: MediaAsset[];
  busy: boolean;
}>();
const emit = defineEmits<{ close: []; edit: []; remove: []; favorite: [] }>();
const video = ref<HTMLVideoElement>();
const videoAsset = computed(() =>
  props.media?.find((asset) => asset.kind === "video"),
);
const photos = computed(() =>
  (props.media ?? []).filter((asset) => asset.kind === "image"),
);

function handleClip(event: "metadata" | "play" | "timeupdate") {
  const player = video.value;
  if (!player) return;
  const action = clipAction(
    player.currentTime,
    { start: props.entry.start, end: props.entry.end },
    event,
  );
  if (!action) return;
  if ("seekTo" in action) player.currentTime = action.seekTo;
  else player.pause();
}
</script>

<template>
  <ModalDialog
    :title="entry.title"
    subtitle="KEPT WITH LOVE"
    :busy="busy"
    @close="emit('close')"
  >
    <p class="detail-date">
      {{ formatDate(entry.capturedAt) }} · {{ formatTime(entry.capturedAt) }}
      <span class="pill">{{ entry.tag }}</span>
    </p>
    <div v-if="entry.care" class="care-detail">
      <span class="eyebrow">{{ CARE_LABELS[entry.care.kind] }}</span
      ><strong>{{ describeCare(entry.care) }}</strong
      ><span>由家长确认的照护记录</span>
    </div>
    <video
      v-if="videoAsset?.url && videoAsset.previewable"
      ref="video"
      class="full-media"
      :src="videoAsset.url"
      :poster="videoAsset.thumbnailUrl || undefined"
      controls
      playsinline
      preload="metadata"
      @loadedmetadata="handleClip('metadata')"
      @loadeddata="handleClip('metadata')"
      @play="handleClip('play')"
      @timeupdate="handleClip('timeupdate')"
    />
    <div
      v-else-if="photos.length"
      class="photo-strip"
      role="group"
      :aria-label="`共 ${photos.length} 张照片`"
    >
      <div
        v-for="(asset, index) in photos"
        :key="asset.id"
        class="photo-strip-item"
      >
        <div class="detail-photo">
          <img
            v-if="asset.url && asset.previewable"
            :src="asset.url"
            class="full-media"
            :alt="`${entry.title} 第 ${index + 1} 张`"
          />
          <img
            v-else-if="asset.thumbnailUrl"
            :src="asset.thumbnailUrl"
            class="full-media"
            :alt="`${entry.title} 第 ${index + 1} 张缩略图`"
          />
          <MediaTile v-else :media="asset" variant="wide" :label="entry.title" />
          <PhotoZoom
            v-if="asset.url || asset.thumbnailUrl"
            :src="asset.url || asset.thumbnailUrl || ''"
            :media="asset"
            :label="entry.title"
          />
        </div>
        <span v-if="photos.length > 1" class="photo-index"
          >{{ index + 1 }} / {{ photos.length }}</span
        >
      </div>
    </div>
    <MediaTile
      v-else-if="!entry.care"
      :media="media?.[0]"
      variant="wide"
      :label="entry.title"
    />
    <p v-if="entry.note" class="detail-note">{{ entry.note }}</p>
    <p v-else class="detail-note muted">这一刻本身，就值得记住。</p>
    <details v-if="entry.care?.sourceText" class="care-source">
      <summary>查看录入原话</summary>
      <p>{{ entry.care.sourceText }}</p>
    </details>
    <p v-if="entry.milestone" class="milestone-note">家长标记的成长里程碑</p>
    <div class="detail-actions">
      <button
        class="button button-secondary"
        type="button"
        @click="emit('edit')"
      >
        <Pencil :size="16" />编辑记录</button
      ><button
        class="icon-button"
        type="button"
        :aria-pressed="entry.favorite"
        :aria-label="entry.favorite ? '取消收藏' : '收藏这个瞬间'"
        @click="emit('favorite')"
      >
        <Heart
          :size="19"
          :fill="entry.favorite ? 'currentColor' : 'none'"
        /></button
      ><button
        class="icon-button danger-text"
        type="button"
        aria-label="删除这条记录"
        @click="emit('remove')"
      >
        <Trash2 :size="18" />
      </button>
    </div>
    <p v-if="media?.some((asset) => asset.demo)" class="fine-print">
      这是示例记录，没有实际宝宝影像。
    </p>
  </ModalDialog>
</template>

<style scoped>
.detail-date {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 12px;
  margin: 14px 0 20px;
}
.care-detail {
  display: grid;
  gap: 13px;
  padding: 25px;
  border-radius: 17px;
  background: var(--tint);
}
.care-detail strong {
  font-size: 30px;
  font-weight: 500;
  color: var(--accent);
}
.detail-photo {
  position: relative;
}
/* P7.1：纯 CSS 横滑，每张对齐中心；不引入拖拽库。 */
.photo-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 6px;
}
.photo-strip-item {
  flex: 0 0 100%;
  min-width: 0;
  scroll-snap-align: center;
}
.photo-strip .photo-index {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  font-size: var(--font-xs);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.care-detail > span:last-child {
  color: var(--muted);
  font-size: 12px;
}
/* 照护记录也可以带照片/视频：内容块在卡片下方时补一点间距。 */
.care-detail + .photo-strip,
.care-detail + video {
  margin-top: 22px;
}
.care-source {
  margin: 0 0 22px;
  color: var(--muted);
  font-size: 12px;
}
.care-source summary {
  cursor: pointer;
  min-height: 44px;
  display: list-item;
  padding-block: 12px;
}
.care-source p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.detail-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.9;
  margin: 24px 0;
  color: var(--ink);
}
.detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.detail-actions > .button {
  flex: 1;
}
.milestone-note {
  font-size: 12px;
  color: var(--sage-ink);
  margin-bottom: 20px;
}
.icon-button[aria-pressed="true"] {
  background: var(--tint);
  color: var(--accent);
}
</style>
