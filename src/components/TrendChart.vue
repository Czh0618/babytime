<script setup lang="ts">
import { computed, ref } from "vue";
import { Sparkles } from "@lucide/vue";
import type { GrowthEntry } from "../types";
import {
  aggregateByDay,
  metricValue,
  nightSummary,
  TREND_METRICS,
  type TrendMetric,
} from "../domain/stats";
import { deriveSleepSegments } from "../domain/sleep";
import {
  TREND_SYSTEM_PROMPT,
  buildStatsDigest,
  guardMedicalOutput,
} from "../domain/ai";
import { aiAvailable, aiChat, aiErrorMessage } from "../lib/ai-service";

const props = defineProps<{ entries: GrowthEntry[]; ageMonths?: number }>();
const range = ref<7 | 30>(7);
const metric = ref<TrendMetric>("intake");
const selectedDate = ref<string | null>(null);
const aiReady = computed(() => aiAvailable());
const insight = ref("");
const insightError = ref("");
const interpreting = ref(false);

/** 只把聚合数字发给模型，结果只展示、不保存。 */
async function interpret() {
  if (interpreting.value || !aiReady.value) return;
  interpreting.value = true;
  insightError.value = "";
  try {
    const night = nightSummary(
      props.entries,
      deriveSleepSegments(props.entries),
      new Date(),
    );
    const digest = buildStatsDigest(stats.value, {
      ageMonths: props.ageMonths,
      night,
    });
    const raw = await aiChat(TREND_SYSTEM_PROMPT, digest);
    insight.value = guardMedicalOutput(raw).text.slice(0, 600);
  } catch (error) {
    insightError.value = aiErrorMessage(error);
  } finally {
    interpreting.value = false;
  }
}

const CHART_W = 300;
const CHART_H = 110;
const BASELINE = 104;

const stats = computed(() => aggregateByDay(props.entries, range.value));
const values = computed(() =>
  stats.value.map((day) => metricValue(day, metric.value)),
);
const max = computed(() =>
  Math.max(
    1,
    ...values.value.filter((_, index) => stats.value[index]!.hasData),
  ),
);
const currentMetric = computed(
  () => TREND_METRICS.find((item) => item.id === metric.value)!,
);
const hasAny = computed(() =>
  stats.value.some((day, index) => day.hasData && values.value[index]! > 0),
);

const bars = computed(() => {
  const count = stats.value.length;
  const gap = count > 14 ? 1.2 : 3;
  const width = (CHART_W - gap * (count - 1)) / count;
  return stats.value.map((day, index) => {
    const value = values.value[index]!;
    const height =
      day.hasData && value > 0
        ? Math.max(3, (value / max.value) * 96)
        : 0;
    return {
      day: day.date,
      x: index * (width + gap),
      width,
      height,
      y: BASELINE - height,
    };
  });
});

const selectedDay = computed(() => {
  const fromClick = selectedDate.value
    ? stats.value.find((day) => day.date === selectedDate.value)
    : undefined;
  if (fromClick?.hasData) return fromClick;
  return [...stats.value].reverse().find((day) => day.hasData);
});

function daySummary(day: (typeof stats.value)[number]): string {
  const [, month, date] = day.date.split("-");
  const sleepHours = Math.round((day.sleepMinutes / 60) * 10) / 10;
  const parts = [
    day.feedingCount
      ? `喂奶 ${day.feedingCount} 次${day.intakeMl ? `（摄入 ${day.intakeMl} ml）` : ""}`
      : "",
    sleepHours ? `睡眠 ${sleepHours} 小时` : "",
    day.diaperCount
      ? `尿布 ${day.diaperCount} 次（湿 ${day.wetCount} / 便 ${day.dirtyCount}）`
      : "",
  ].filter(Boolean);
  return `${Number(month)}月${Number(date)}日：${parts.join(" · ") || "已记录其他照护"}`;
}

function labelFor(date: string, index: number): string {
  if (range.value === 30 && index % 5 !== 0 && index !== stats.value.length - 1)
    return "";
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}
</script>

<template>
  <section class="trend-card" aria-labelledby="trend-heading">
    <div class="trend-heading">
      <div>
        <p class="eyebrow">GROWTH TREND</p>
        <h2 id="trend-heading" class="section-heading">成长趋势</h2>
      </div>
      <div class="trend-range" role="group" aria-label="时间范围">
        <button
          v-for="option in [7, 30]"
          :key="option"
          type="button"
          :class="{ active: range === option }"
          :aria-pressed="range === option"
          @click="range = option as 7 | 30"
        >
          {{ option }} 天
        </button>
      </div>
    </div>
    <div class="trend-metrics" role="group" aria-label="指标">
      <button
        v-for="item in TREND_METRICS"
        :key="item.id"
        type="button"
        :class="{ active: metric === item.id }"
        :aria-pressed="metric === item.id"
        @click="metric = item.id"
      >
        {{ item.label }}
      </button>
    </div>
    <p v-if="!hasAny" class="trend-note">
      这段时间还没有{{ currentMetric.label }}记录，先记几条再来看趋势。
    </p>
    <div v-else class="trend-plot">
      <svg
        class="trend-svg"
        :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="`最近 ${range} 天的${currentMetric.label}趋势`"
      >
        <line
          x1="0"
          :y1="BASELINE"
          :x2="CHART_W"
          :y2="BASELINE"
          class="trend-axis"
        />
        <template v-for="bar in bars" :key="bar.day">
          <rect
            v-if="bar.height > 0"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            :class="['trend-bar', { active: selectedDay?.date === bar.day }]"
            @click="selectedDate = bar.day"
          />
        </template>
      </svg>
      <div class="trend-labels" aria-hidden="true">
        <span v-for="(day, index) in stats" :key="day.date">{{
          labelFor(day.date, index)
        }}</span>
      </div>
    </div>
    <p v-if="selectedDay" class="trend-note">
      {{ daySummary(selectedDay) }}
    </p>
    <p class="trend-note muted">
      单位：{{ currentMetric.unit }} · 点击柱子可看单日汇总，无记录的日子留空。
    </p>
    <div class="trend-ai">
      <button
        class="button button-secondary"
        type="button"
        :disabled="interpreting || !aiReady"
        @click="interpret"
      >
        <Sparkles :size="15" aria-hidden="true" />{{
          interpreting ? "AI 正在看…" : "AI 帮我看看"
        }}
      </button>
      <span v-if="!aiReady" class="trend-ai-hint">
        先在「家庭 → AI 辅助整理」里配置模型服务
      </span>
    </div>
    <p v-if="insight" class="trend-insight">{{ insight }}</p>
    <p v-if="insight" class="trend-ai-hint">
      AI 只收到按天汇总的数字，结果不保存，也不构成健康判断。
    </p>
    <p v-if="insightError" class="trend-ai-error" role="alert">
      {{ insightError }}
    </p>
  </section>
</template>

<style scoped>
.trend-card {
  margin: 20px 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.trend-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.trend-heading h2 {
  font-size: 18px;
}
.trend-range,
.trend-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.trend-metrics {
  margin-top: 12px;
}
.trend-range button,
.trend-metrics button {
  min-height: 44px;
  padding: 8px 13px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--bg);
  color: var(--muted);
  font-size: 12px;
}
.trend-range button.active,
.trend-metrics button.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.trend-svg {
  display: block;
  width: 100%;
  height: 120px;
  margin-top: 14px;
  overflow: visible;
}
.trend-axis {
  stroke: var(--line);
  stroke-width: 1;
}
.trend-bar {
  fill: var(--accent);
  opacity: 0.78;
  cursor: pointer;
}
.trend-bar.active {
  opacity: 1;
}
.trend-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: var(--muted);
  font-size: var(--font-xs);
}
.trend-labels span {
  flex: 1;
  text-align: center;
  white-space: nowrap;
}
.trend-note {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
.trend-ai {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.trend-ai .button {
  min-height: 40px;
  font-size: 13px;
}
.trend-ai-hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.trend-insight {
  margin: 10px 0 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.trend-ai-error {
  margin: 10px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 400px) {
  .trend-card {
    padding: 14px;
  }
  .trend-svg {
    height: 100px;
  }
}
</style>
