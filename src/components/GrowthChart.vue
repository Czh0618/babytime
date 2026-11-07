<script setup lang="ts">
import { computed } from "vue";
import type { GrowthPoint } from "../domain/growth";
import { formatDate } from "../domain/date";

const props = defineProps<{
  points: GrowthPoint[];
  label: string;
  unit: string;
  corrected?: boolean;
}>();

const WIDTH = 320;
const HEIGHT = 156;
const PAD = { left: 34, right: 10, top: 12, bottom: 26 };

const bounds = computed(() => {
  const values = props.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.5, max - min);
  return { min: min - span * 0.15, max: max + span * 0.15 };
});

const xMax = computed(() =>
  Math.max(6, ...props.points.map((point) => point.months)),
);

function x(months: number) {
  const width = WIDTH - PAD.left - PAD.right;
  return PAD.left + (months / xMax.value) * width;
}

function y(value: number) {
  const height = HEIGHT - PAD.top - PAD.bottom;
  const { min, max } = bounds.value;
  const ratio = (value - min) / (max - min || 1);
  return PAD.top + (1 - ratio) * height;
}

const path = computed(() =>
  props.points
    .map((point, index) => `${index ? "L" : "M"}${x(point.months).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(" "),
);

const last = computed(() => props.points[props.points.length - 1]);

function round(value: number) {
  return Math.round(value * 10) / 10;
}
</script>

<template>
  <figure class="growth-chart">
    <figcaption class="chart-caption">
      <span>{{ label }}（{{ unit }}）</span>
      <span v-if="corrected" class="corrected">按矫正月龄</span>
    </figcaption>
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      role="img"
      :aria-label="`${label}随月龄变化的折线图，共 ${points.length} 个记录点`"
    >
      <line
        :x1="PAD.left"
        :x2="WIDTH - PAD.right"
        :y1="HEIGHT - PAD.bottom"
        :y2="HEIGHT - PAD.bottom"
        class="axis"
      />
      <line
        :x1="PAD.left"
        :x2="PAD.left"
        :y1="PAD.top"
        :y2="HEIGHT - PAD.bottom"
        class="axis"
      />
      <path :d="path" class="series" />
      <circle
        v-for="point in points"
        :key="point.date"
        :cx="x(point.months)"
        :cy="y(point.value)"
        r="3.4"
        class="dot"
      />
    </svg>
    <div class="axis-labels">
      <span>0 月</span>
      <span>{{ round(xMax) }} 月</span>
    </div>
    <p v-if="last" class="chart-last">
      最近：{{ formatDate(last.date) }} · {{ last.value }} {{ unit }}
    </p>
  </figure>
</template>

<style scoped>
.growth-chart {
  margin: 0;
  display: grid;
  gap: 6px;
}
.chart-caption {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: var(--font-xs);
}
.corrected {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tint);
}
svg {
  width: 100%;
  height: auto;
  display: block;
}
.axis {
  stroke: var(--line);
  stroke-width: 1;
}
.series {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 1.5;
}
.axis-labels {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
}
.chart-last {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
</style>
