<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight, Heart, Plus, Sparkles, Star } from "@lucide/vue";
import MediaTile from "../components/MediaTile.vue";
import type { BabyProfile, GrowthEntry, MediaAsset } from "../types";
import { dayAge, formatDate, formatTime } from "../domain/date";
import { ageOn } from "../domain/age";
import { describeCare } from "../domain/care-records";

const props = defineProps<{
  baby: BabyProfile;
  entries: GrowthEntry[];
  media: MediaAsset[];
  pendingCount: number;
}>();

const emit = defineEmits<{
  add: [];
  demo: [];
  review: [];
  favorite: [id: string];
  open: [entry: GrowthEntry];
}>();

const filter = ref<"all" | "favorite" | "milestone">("all");
const hasValidBirthday = computed(() => ageOn(props.baby.birthDate).valid);

const visibleEntries = computed(() =>
  [...props.entries]
    .filter((entry) => {
      if (filter.value === "favorite") return entry.favorite;
      if (filter.value === "milestone") return entry.milestone;
      return true;
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
);

const mediaById = computed(
  () => new Map(props.media.map((asset) => [asset.id, asset])),
);
const monthLabel = computed(() => {
  const now = new Date();
  return `${new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(now)} · ${now.getFullYear()}`;
});

function mediaFor(entry: GrowthEntry) {
  return entry.mediaId ? mediaById.value.get(entry.mediaId) : undefined;
}

function openEntry(entry: GrowthEntry) {
  emit("open", entry);
}
</script>

<template>
  <section class="time-page" aria-labelledby="time-heading">
    <header class="page-topline">
      <div>
        <p class="eyebrow">宝宝时光</p>
        <h1 id="time-heading" class="page-heading">{{ baby.name }}的今天</h1>
        <p v-if="hasValidBirthday" class="muted">
          第 {{ dayAge(baby.birthDate) }} 天 ·
          {{ formatDate(new Date().toISOString()) }}
        </p>
        <p v-else class="muted">
          <a href="#family">填写出生日期，获得月龄推荐</a>
        </p>
      </div>
      <button
        class="button button-secondary add-button"
        type="button"
        @click="emit('add')"
      >
        <Plus :size="17" aria-hidden="true" />
        <span>记录</span>
      </button>
    </header>

    <div v-if="$slots.today" class="today-features"><slot name="today" /></div>
    <section v-else class="memory-banner" aria-label="成长手记寄语">
      <p class="memory-month">{{ monthLabel }}</p>
      <p class="memory-quote">日子慢慢过，<br />你在悄悄长大。</p>
      <p class="memory-caption">为平常日子，留一点位置。</p>
    </section>

    <div v-if="pendingCount > 0" class="review-banner" role="status">
      <div class="review-banner-icon">
        <Sparkles :size="19" aria-hidden="true" />
      </div>
      <div>
        <strong>{{ pendingCount }} 个瞬间，等你来确认</strong>
        <span>素材已经保存，决定权交给你。</span>
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="查看待整理瞬间"
        @click="emit('review')"
      >
        <ChevronRight :size="19" aria-hidden="true" />
      </button>
    </div>

    <div class="section-heading-row">
      <div>
        <p class="eyebrow">最近的时光</p>
        <h2 class="section-heading">已经收进来的日子</h2>
      </div>
      <span class="muted">{{ entries.length }} 条</span>
    </div>

    <div class="filter-tabs" aria-label="记录筛选">
      <button
        type="button"
        :class="['filter-tab', { active: filter === 'all' }]"
        :aria-pressed="filter === 'all'"
        @click="filter = 'all'"
      >
        全部
      </button>
      <button
        type="button"
        :class="['filter-tab', { active: filter === 'favorite' }]"
        :aria-pressed="filter === 'favorite'"
        @click="filter = 'favorite'"
      >
        收藏
      </button>
      <button
        type="button"
        :class="['filter-tab', { active: filter === 'milestone' }]"
        :aria-pressed="filter === 'milestone'"
        @click="filter = 'milestone'"
      >
        里程碑
      </button>
    </div>

    <div v-if="visibleEntries.length" class="entry-list">
      <article
        v-for="entry in visibleEntries"
        :key="entry.id"
        class="entry-row"
      >
        <button class="entry-main" type="button" @click="openEntry(entry)">
          <MediaTile
            :media="mediaFor(entry)"
            variant="thumb"
            :label="entry.title"
          />
          <span class="entry-copy">
            <strong>{{ entry.title }}</strong>
            <span class="muted"
              >{{ formatDate(entry.capturedAt) }} ·
              {{ formatTime(entry.capturedAt) }}</span
            >
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
          :aria-label="
            entry.favorite ? `取消收藏${entry.title}` : `收藏${entry.title}`
          "
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
    </div>

    <div v-else class="empty-state">
      <Star :size="28" aria-hidden="true" />
      <h3>这一栏还没有记录</h3>
      <p>新的照片和视频，会在你确认后出现在这里。</p>
      <button
        class="button button-secondary"
        type="button"
        @click="emit('add')"
      >
        开始记录
      </button>
      <button
        v-if="!entries.length"
        class="button button-ghost"
        type="button"
        @click="emit('demo')"
      >
        先看看示例
      </button>
    </div>
  </section>
</template>

<style scoped>
.time-page {
  display: grid;
  gap: 24px;
}
.today-features {
  display: grid;
  gap: 26px;
  min-width: 0;
}
.page-topline,
.section-heading-row,
.review-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.page-topline {
  align-items: flex-start;
}
.add-button {
  flex: none;
}
.review-banner {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  background: var(--surface);
  text-align: left;
}
.memory-banner {
  display: grid;
  gap: 12px;
  min-height: 182px;
  padding: 21px;
  border-radius: var(--radius);
  background: var(--tint);
  position: relative;
  overflow: hidden;
}
.memory-banner::after {
  content: "";
  position: absolute;
  width: 150px;
  height: 150px;
  right: -22px;
  top: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--surface) 30%, transparent);
  pointer-events: none;
}
.memory-month,
.memory-quote,
.memory-caption {
  position: relative;
  z-index: 1;
  margin: 0;
}
.memory-month {
  color: var(--muted);
  font-size: var(--font-xs);
  letter-spacing: 1.8px;
  text-transform: uppercase;
}
.memory-quote {
  max-width: 260px;
  font-family: Georgia, "Songti SC", serif;
  font-size: clamp(25px, 7vw, 32px);
  line-height: 1.48;
  letter-spacing: 1px;
}
.memory-caption {
  color: var(--muted);
  font-size: 12px;
}
.review-banner-icon {
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border-radius: 13px;
  color: var(--accent);
  background: var(--tint);
}
.review-banner > div:nth-child(2) {
  display: grid;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.review-banner strong {
  font-weight: 600;
}
.review-banner span {
  color: var(--muted);
  font-size: 12px;
}
.section-heading-row {
  align-items: end;
}
.section-heading-row .muted {
  white-space: nowrap;
}
.filter-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.filter-tab {
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
}
.filter-tab.active {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--surface);
}
.entry-list {
  display: grid;
}
.entry-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px 0;
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
.empty-state {
  display: grid;
  justify-items: center;
  gap: 9px;
  padding: 48px 20px;
  color: var(--muted);
  text-align: center;
}
.empty-state h3 {
  margin: 4px 0 0;
  color: var(--ink);
  font-size: 17px;
}
.empty-state p {
  max-width: 260px;
  margin: 0 0 12px;
  font-size: 13px;
}
@media (max-width: 380px) {
  .page-topline {
    align-items: flex-start;
  }
  .page-heading {
    font-size: 22px;
  }
  .review-banner {
    align-items: flex-start;
  }
}
</style>
