<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Baby, Milk, Moon } from "@lucide/vue";
import type { GrowthEntry } from "../types";
import type { CareKind } from "../domain/care-types";
import { localDate, formatTime } from "../domain/date";
import { describeCare, summarizeMilk } from "../domain/care-records";
import {
  deriveSleepSegments,
  formatMinutes,
  sleepSummaryForDay,
} from "../domain/sleep";
const props = defineProps<{ entries: GrowthEntry[] }>();
const emit = defineEmits<{ voice: []; open: [entry: GrowthEntry] }>();
const categories = [
  { kind: "feeding", title: "喂奶", icon: Milk },
  { kind: "sleep", title: "睡眠", icon: Moon },
  { kind: "diaper", title: "换尿布", icon: Baby },
] as const;
const milk = computed(() => summarizeMilk(props.entries));
const sleep = computed(() =>
  sleepSummaryForDay(deriveSleepSegments(props.entries), localDate()),
);
const now = ref(Date.now());
const tick = () => (now.value = Date.now());
const timer = setInterval(tick, 60_000);
// 后台标签页的定时器会被浏览器节流，回到前台时立刻校准一次。
const onVisible = () => document.visibilityState === "visible" && tick();
document.addEventListener("visibilitychange", onVisible);
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener("visibilitychange", onVisible);
});
function since(iso: string) {
  const minutes = Math.max(0, Math.round((now.value - Date.parse(iso)) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} 小时 ${m} 分前` : `${h} 小时前`;
}
const latest = computed(() => {
  const result: Partial<Record<CareKind, GrowthEntry>> = {};
  const now = Date.now();
  [...props.entries]
    .filter(
      (entry) =>
        entry.care &&
        entry.capturedAt.slice(0, 10) === localDate() &&
        new Date(entry.capturedAt).getTime() <= now,
    )
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .forEach((entry) => {
      const kind = entry.care!.kind;
      if (!result[kind]) result[kind] = entry;
    });
  return result;
});
</script>

<template>
  <section aria-labelledby="today-care-heading">
    <div class="care-summary-heading">
      <h2 id="today-care-heading">今天的照护</h2>
      <span>距上次记录</span>
    </div>
    <div class="care-summary-grid">
      <button
        v-for="item in categories"
        :key="item.kind"
        class="care-summary-item"
        type="button"
        :aria-label="
          latest[item.kind]
            ? `查看最近${item.title}记录`
            : `语音记录${item.title}`
        "
        @click="
          latest[item.kind] ? emit('open', latest[item.kind]!) : emit('voice')
        "
      >
        <span class="care-summary-label"
          ><component :is="item.icon" :size="15" aria-hidden="true" />{{
            item.title
          }}</span
        ><strong>{{
          latest[item.kind]
            ? since(latest[item.kind]!.capturedAt)
            : "还未记录"
        }}</strong
        ><span class="care-summary-value">{{
          latest[item.kind]
            ? `${formatTime(latest[item.kind]!.capturedAt)} · ${describeCare(latest[item.kind]!.care!)}`
            : "点一下记下来"
        }}</span>
      </button>
    </div>
    <p v-if="milk.intakeMl || milk.pumpedMl" class="milk-summary">
      今日奶量：摄入 {{ milk.intakeMl }} ml<span v-if="milk.pumpedMl">
        · 吸出 {{ milk.pumpedMl }} ml（不计入摄入）</span
      >
    </p>
    <p v-if="sleep.totalMinutes" class="milk-summary">
      今日睡眠：共 {{ formatMinutes(sleep.totalMinutes) }} · 最长一段
      {{ formatMinutes(sleep.longestMinutes) }}
    </p>
  </section>
</template>

<style scoped>
.milk-summary {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.6;
}
.care-summary-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.care-summary-heading h2 {
  font-size: 15px;
  font-weight: 500;
}
.care-summary-heading > span {
  font-size: 12px;
  color: var(--muted);
}
.care-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.care-summary-item {
  display: grid;
  gap: 9px;
  min-height: 116px;
  text-align: left;
  padding: 15px 14px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: var(--surface);
}
.care-summary-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.care-summary-item strong {
  font-size: 19px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.care-summary-value {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
@media (max-width: 400px) {
  .care-summary-grid {
    gap: 7px;
  }
  .care-summary-item {
    padding: 13px 10px;
  }
  .care-summary-item strong {
    font-size: 16px;
  }
  .care-summary-label {
    font-size: var(--font-xs);
    gap: 4px;
  }
}
</style>
