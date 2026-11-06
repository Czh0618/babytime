<script setup lang="ts">
import { Heart, Pencil, Trash2 } from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";
import MediaTile from "./MediaTile.vue";
import PhotoZoom from "./PhotoZoom.vue";
import type { GrowthEntry, MediaAsset } from "../types";
import { formatDate, formatTime } from "../domain/date";
import { describeCare } from "../domain/care-records";
import { CARE_LABELS } from "../domain/care-types";
defineProps<{ entry: GrowthEntry; media?: MediaAsset; busy: boolean }>();
const emit = defineEmits<{ close: []; edit: []; remove: []; favorite: [] }>();
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
      v-else-if="media?.kind === 'video' && media.url && media.previewable"
      class="full-media"
      :src="`${media.url}#t=${entry.start || 0}${entry.end ? ',' + entry.end : ''}`"
      controls
      playsinline
      preload="metadata"
    />
    <div
      v-else-if="media?.kind === 'image' && media.url && media.previewable"
      class="detail-photo"
    >
      <img :src="media.url" class="full-media" :alt="entry.title" />
      <PhotoZoom :src="media.url" :label="entry.title" />
    </div>
    <MediaTile v-else :media="media" variant="wide" :label="entry.title" />
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
    <p v-if="media?.demo" class="fine-print">
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
.care-detail > span:last-child {
  color: var(--muted);
  font-size: 12px;
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
