<script setup lang="ts">
import { Download } from "@lucide/vue";
import { computed } from "vue";
import ModalDialog from "./ModalDialog.vue";
import MediaTile from "./MediaTile.vue";
import type { GrowthEntry, MediaAsset, Recap } from "../types";
import { formatDate } from "../domain/date";
import { describeCare } from "../domain/care-records";
const props = defineProps<{
  recap: Recap;
  entries: GrowthEntry[];
  media: MediaAsset[];
  babyName: string;
  busy: boolean;
  error?: string;
}>();
const emit = defineEmits<{ close: []; download: [] }>();
const ordered = computed(() =>
  props.recap.entryIds
    .map((id) => props.entries.find((entry) => entry.id === id))
    .filter((entry): entry is GrowthEntry => Boolean(entry)),
);
</script>

<template>
  <ModalDialog
    :title="recap.title"
    subtitle="OUR LITTLE JOURNAL"
    wide
    :busy="busy"
    @close="emit('close')"
  >
    <div class="recap-intro">
      <p>{{ babyName }}的成长手记</p>
      <h3>和你一起，<br />记住这些小日子。</h3>
      <p>{{ formatDate(recap.dateFrom) }} — {{ formatDate(recap.dateTo) }}</p>
    </div>
    <article v-for="entry in ordered" :key="entry.id" class="recap-moment">
      <MediaTile
        v-if="entry.mediaId"
        :media="media.find((item) => item.id === entry.mediaId)"
        variant="wide"
        :label="entry.title"
        zoomable
      />
      <p class="eyebrow">
        {{ formatDate(entry.capturedAt) }} · {{ entry.tag }}
      </p>
      <h3>{{ entry.title }}</h3>
      <p v-if="entry.care" class="recap-note">{{ describeCare(entry.care) }}</p>
      <p class="recap-note">{{ entry.note }}</p>
    </article>
    <div v-if="!ordered.length" class="empty-state">
      <p>这份回顾里的记录已被移除，可以重新选择瞬间。</p>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <button
      class="button button-primary full-width"
      type="button"
      :disabled="busy"
      @click="emit('download')"
    >
      <Download :size="17" />{{ busy ? "正在准备…" : "导出图文回顾" }}
    </button>
    <p class="fine-print">
      导出可离线打开的图文页面，视频使用静帧，不包含原片。
    </p>
  </ModalDialog>
</template>

<style scoped>
.recap-intro {
  padding: 30px 24px;
  margin: 23px 0;
  background: var(--tint);
  border-radius: 20px;
  color: var(--accent);
}
.recap-intro > p {
  font-size: 12px;
  letter-spacing: 1px;
}
.recap-intro h3 {
  font:
    400 30px/1.6 Georgia,
    "Songti SC",
    serif;
  letter-spacing: 1px;
  margin: 22px 0;
}
.recap-moment {
  display: grid;
  gap: 12px;
  padding-bottom: 27px;
  margin-bottom: 27px;
  border-bottom: 1px solid var(--line);
}
.recap-moment > .eyebrow {
  margin-top: 8px;
}
.recap-moment h3 {
  font-size: 20px;
  font-weight: 500;
}
.recap-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--muted);
  line-height: 1.8;
}
</style>
