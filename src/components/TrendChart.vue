<script setup lang="ts">
import { computed, ref } from "vue";
import type { GrowthEntry } from "../types";
import {
  aggregateByDay,
  metricValue,
  TREND_METRICS,
  type TrendMetric,
} from "../domain/stats";

const props = defineProps<{ entries: GrowthEntry[] }>();
const range = ref<7 | 30>(7);
const metric = ref<TrendMetric>("intake");

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
            class="trend-bar"
          />
        </template>
      </svg>
      <div class="trend-labels" aria-hidden="true">
        <span v-for="(day, index) in stats" :key="day.date">{{
          labelFor(day.date, index)
        }}</span>
      </div>
    </div>
    <p class="trend-note muted">
      单位：{{ currentMetric.unit }} · 没有记录的日子留空，不按 0 显示。
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
@media (max-width: 400px) {
  .trend-card {
    padding: 14px;
  }
  .trend-svg {
    height: 100px;
  }
}
</style>
