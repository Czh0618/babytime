<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Baby, Milk, Moon, Pill, Thermometer } from "@lucide/vue";
import type { GrowthEntry } from "../types";
import { localDate, formatTime } from "../domain/date";
import {
  describeCare,
  hoursSince,
  lastMedicineEntry,
  latestCareByKind,
  summarizeMilk,
  summarizeTemperature,
} from "../domain/care-records";
import {
  deriveSleepSegments,
  formatMinutes,
  ongoingSleep,
  sleepSummaryForDay,
} from "../domain/sleep";
import { nightSummary } from "../domain/stats";
import { nextFeedingReference } from "../domain/feeding";
const props = withDefaults(
  defineProps<{ entries: GrowthEntry[]; night?: boolean }>(),
  { night: false },
);
const emit = defineEmits<{ voice: []; open: [entry: GrowthEntry] }>();
const categories = [
  { kind: "feeding", title: "喂奶", icon: Milk },
  { kind: "sleep", title: "睡眠", icon: Moon },
  { kind: "diaper", title: "换尿布", icon: Baby },
  { kind: "temperature", title: "体温", icon: Thermometer },
  { kind: "medicine", title: "用药", icon: Pill },
] as const;
const now = ref(Date.now());
const milk = computed(() => summarizeMilk(props.entries));
const temperature = computed(() =>
  summarizeTemperature(props.entries, localDate()),
);
const lastMedicine = computed(() =>
  lastMedicineEntry(props.entries, new Date(now.value)),
);
const sleep = computed(() =>
  sleepSummaryForDay(deriveSleepSegments(props.entries), localDate()),
);
const ongoing = computed(() =>
  ongoingSleep(props.entries, new Date(now.value)),
);
const ongoingDuration = computed(() =>
  ongoing.value
    ? formatMinutes(
        Math.max(1, (now.value - Date.parse(ongoing.value.capturedAt)) / 60_000),
      )
    : "",
);
const nightly = computed(() =>
  nightSummary(
    props.entries,
    deriveSleepSegments(props.entries),
    new Date(now.value),
  ),
);
const reference = computed(() =>
  nextFeedingReference(props.entries, new Date(now.value)),
);
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
/** 跨午夜仍显示昨晚的最近一条；「今天」只看当天会让夜奶显示成还未记录。 */
const latest = computed(() =>
  latestCareByKind(props.entries, new Date(now.value)),
);
</script>

<template>
  <section
    class="care-summary"
    aria-labelledby="today-care-heading"
    :class="{ 'night-mode': props.night }"
  >
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
    <p v-if="reference" class="milk-summary">
      下次喂奶参考：约 {{ reference.time }} · 按最近
      {{ reference.sampleSize }} 次间隔{{ reference.passed ? "（已过）" : "" }}
    </p>
    <p v-if="temperature" class="milk-summary">
      今日最高体温：{{ temperature.maxC }}℃ · {{ formatTime(temperature.at)
      }}<span v-if="temperature.count > 1">（共 {{ temperature.count }} 次）</span>
    </p>
    <p v-if="temperature && lastMedicine" class="milk-summary">
      距上次用药：{{ hoursSince(lastMedicine.capturedAt, new Date(now)) }} · 上次
      {{ formatTime(lastMedicine.capturedAt) }}
      {{ describeCare(lastMedicine.care!) }}
    </p>
    <p v-if="ongoing" class="milk-summary">
      正在睡：{{ formatTime(ongoing.capturedAt) }} 入睡 · 已睡
      {{ ongoingDuration }}
    </p>
    <p v-if="sleep.totalMinutes" class="milk-summary">
      今日睡眠：共 {{ formatMinutes(sleep.totalMinutes) }} · 最长一段
      {{ formatMinutes(sleep.longestMinutes) }}
    </p>
    <p
      v-if="nightly.wakeCount || nightly.longestSleepMinutes"
      class="milk-summary"
    >
      昨夜：醒来 {{ nightly.wakeCount }} 次 · 最长连续睡眠
      {{ formatMinutes(nightly.longestSleepMinutes) }}
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
/* 夜间：放大常用照护按钮，背景换成低亮度暖色；文字仍保持高对比不牺牲可读性。 */
.night-mode .care-summary-item {
  min-height: 140px;
  padding: 18px 14px;
  background: var(--tint);
}
.night-mode .care-summary-item strong {
  font-size: 22px;
}
.night-mode .care-summary-heading h2 {
  color: var(--muted);
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
  .night-mode .care-summary-item {
    min-height: 128px;
    padding: 15px 10px;
  }
}
</style>
