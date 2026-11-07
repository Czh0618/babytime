<script setup lang="ts">
import { Heart } from "@lucide/vue";
import MediaTile from "./MediaTile.vue";
import type { GrowthEntry, MediaAsset } from "../types";
import { describeCare } from "../domain/care-records";
import { formatTime } from "../domain/date";

defineProps<{ entry: GrowthEntry; media?: MediaAsset }>();
const emit = defineEmits<{ open: [entry: GrowthEntry]; favorite: [id: string] }>();
</script>

<template>
  <article class="entry-row">
    <button class="entry-main" type="button" @click="emit('open', entry)">
      <MediaTile :media="media" variant="thumb" :label="entry.title" />
      <span class="entry-copy">
        <strong>{{ entry.title }}</strong>
        <span class="muted">{{ formatTime(entry.capturedAt) }}</span>
        <span class="entry-tag">
          {{ entry.tag }}
          <template v-if="entry.care">
            · {{ describeCare(entry.care) }}</template
          >
          <template v-if="entry.milestone"> · 家长标记里程碑</template>
        </span>
      </span>
    </button>
    <button
      class="icon-button favorite-button"
      type="button"
      :aria-label="entry.favorite ? `取消收藏${entry.title}` : `收藏${entry.title}`"
      :aria-pressed="entry.favorite"
      @click.stop="emit('favorite', entry.id)"
    >
      <Heart
        :size="18"
        :fill="entry.favorite ? 'currentColor' : 'none'"
        aria-hidden="true"
      />
    </button>
  </article>
</template>

<style scoped>
.entry-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.entry-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.entry-main:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 5px;
  border-radius: 8px;
}
.entry-copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.entry-copy strong {
  overflow: hidden;
  margin: 0 0 2px;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-tag {
  display: inline-block;
  margin-top: 4px;
  color: var(--muted);
  font-size: var(--font-xs);
}
.favorite-button {
  flex: none;
  color: var(--muted);
}
.favorite-button[aria-pressed="true"] {
  color: var(--accent);
  background: var(--tint);
}
</style>
