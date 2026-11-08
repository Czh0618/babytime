<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Search,
  Sparkles,
  Star,
} from "@lucide/vue";
import TimelineRow from "../components/TimelineRow.vue";
import type { BabyProfile, GrowthEntry, MediaAsset } from "../types";
import { dayAge, formatDate } from "../domain/date";
import { ageOn } from "../domain/age";
import {
  buildTimeline,
  filterTimelineEntries,
  hasTimelineQuery,
  TIMELINE_CARE_FILTERS,
  type TimelineCareFilter,
} from "../domain/timeline";

const props = defineProps<{
  baby: BabyProfile;
  entries: GrowthEntry[];
  media: MediaAsset[];
  pendingCount: number;
  night?: boolean;
}>();

const emit = defineEmits<{
  add: [];
  demo: [];
  review: [];
  favorite: [id: string];
  open: [entry: GrowthEntry];
}>();

const filter = ref<"all" | "favorite" | "milestone">("all");
const keyword = ref("");
const careFilter = ref<TimelineCareFilter>("all");
const hasValidBirthday = computed(() => ageOn(props.baby.birthDate).valid);
const hasQuery = computed(() =>
  hasTimelineQuery(keyword.value, careFilter.value),
);

const visibleEntries = computed(() =>
  filterTimelineEntries(
    [...props.entries].filter((entry) => {
      if (filter.value === "favorite") return entry.favorite;
      if (filter.value === "milestone") return entry.milestone;
      return true;
    }),
    keyword.value,
    careFilter.value,
  ),
);

/** 首屏只渲染 14 天，之后每次再加 14 天，避免几千条记录一次铺开。 */
const PAGE_DAYS = 14;
const limitDays = ref(PAGE_DAYS);
const expanded = ref<Set<string>>(new Set());
const timeline = computed(() =>
  buildTimeline(visibleEntries.value, limitDays.value),
);

watch([filter, keyword, careFilter], () => {
  limitDays.value = PAGE_DAYS;
  expanded.value = new Set();
});

const mediaById = computed(
  () => new Map(props.media.map((asset) => [asset.id, asset])),
);
const monthLabel = computed(() => {
  const now = new Date();
  return `${new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(now)} · ${now.getFullYear()}`;
});

/** P7.1：时间线只显示封面，多图由 MediaTile 的「+N」角标提示。 */
function mediaFor(entry: GrowthEntry) {
  return entry.mediaIds?.[0]
    ? mediaById.value.get(entry.mediaIds[0])
    : undefined;
}

function openEntry(entry: GrowthEntry) {
  emit("open", entry);
}

function weekday(date: string) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(
    new Date(`${date}T12:00`),
  );
}

/** 搜索或按照护类别筛选时，自动展开命中的照护记录，不让结果藏在折叠行里。 */
function isExpanded(date: string) {
  return hasQuery.value || expanded.value.has(date);
}

function toggleDay(date: string) {
  const next = new Set(expanded.value);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  expanded.value = next;
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

    <div
      v-if="$slots.today"
      class="today-features"
      :data-night="props.night ? 'true' : undefined"
    >
      <slot name="today" />
    </div>
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
      <span class="muted">
        {{ visibleEntries.length }} 条<template v-if="hasQuery">
          / 共 {{ entries.length }} 条</template
        >
      </span>
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

    <div class="timeline-filters">
      <label class="search-field">
        <Search :size="16" aria-hidden="true" />
        <input
          v-model="keyword"
          type="search"
          placeholder="搜标题、备注、照护内容或原话"
          aria-label="搜索记录"
        />
      </label>
      <div class="care-filter-tabs" aria-label="照护类别筛选">
        <button
          v-for="item in TIMELINE_CARE_FILTERS"
          :key="item.id"
          type="button"
          :class="['filter-tab', { active: careFilter === item.id }]"
          :aria-pressed="careFilter === item.id"
          @click="careFilter = item.id"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div v-if="timeline.days.length" class="timeline">
      <section
        v-for="day in timeline.days"
        :key="day.date"
        class="day-block"
        :aria-labelledby="`day-${day.date}`"
      >
        <div class="day-head">
          <h3 :id="`day-${day.date}`">
            {{ formatDate(day.date) }}
            <span class="day-week">{{ weekday(day.date) }}</span>
          </h3>
          <span class="muted">{{ day.entries.length }} 条</span>
        </div>
        <TimelineRow
          v-for="entry in day.memories"
          :key="entry.id"
          :entry="entry"
          :media="mediaFor(entry)"
          @open="openEntry"
          @favorite="(id) => emit('favorite', id)"
        />
        <template v-if="day.care.length">
          <button
            v-if="!isExpanded(day.date)"
            class="care-fold"
            type="button"
            :aria-expanded="false"
            @click="toggleDay(day.date)"
          >
            <span class="care-fold-label">照护</span>
            <span class="care-fold-summary">{{ day.careSummary }}</span>
            <ChevronDown :size="16" aria-hidden="true" />
          </button>
          <template v-else>
            <TimelineRow
              v-for="entry in day.care"
              :key="entry.id"
              :entry="entry"
              :media="mediaFor(entry)"
              @open="openEntry"
              @favorite="(id) => emit('favorite', id)"
            />
            <button
              v-if="!hasQuery"
              class="care-fold care-fold-close"
              type="button"
              :aria-expanded="true"
              @click="toggleDay(day.date)"
            >
              <span class="care-fold-label">收起照护记录</span>
              <ChevronUp :size="16" aria-hidden="true" />
            </button>
          </template>
        </template>
      </section>
      <button
        v-if="timeline.hasMore"
        class="button button-secondary load-more"
        type="button"
        @click="limitDays += PAGE_DAYS"
      >
        加载更早的日子（还有
        {{ timeline.totalDays - timeline.days.length }} 天）
      </button>
    </div>

    <div v-else class="empty-state">
      <Star :size="28" aria-hidden="true" />
      <h3>{{ hasQuery ? "没有匹配的记录" : "这一栏还没有记录" }}</h3>
      <p>
        {{
          hasQuery
            ? "换个关键词或照护类别试试。"
            : "新的照片和视频，会在你确认后出现在这里。"
        }}
      </p>
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
/* 夜间把常用照护按钮置顶；slot 内容来自父组件，需要 :deep。 */
.today-features[data-night="true"] > :deep(.care-summary) {
  order: -1;
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
.timeline-filters {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
}
.search-field:focus-within {
  border-color: var(--accent);
}
.search-field input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  outline: none;
}
.care-filter-tabs,
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
.timeline {
  display: grid;
  gap: 22px;
}
.day-block {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.day-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.day-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.day-week {
  margin-left: 6px;
  color: var(--muted);
  font-size: var(--font-xs);
  font-weight: 400;
}
.care-fold {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.care-fold-label {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--tint);
  color: var(--muted);
  font-size: 12px;
}
.care-fold-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.care-fold-close {
  justify-content: center;
  color: var(--muted);
  font-size: var(--font-xs);
}
.load-more {
  justify-self: center;
  margin-top: 4px;
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
