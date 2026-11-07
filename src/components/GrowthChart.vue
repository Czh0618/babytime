<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GrowthPoint } from "../domain/growth";
import { formatDate } from "../domain/date";
import {
  percentileBand,
  referenceLines,
} from "../domain/growth-percentiles";
import type {
  GrowthMetricId,
  GrowthSex,
} from "../data/growth-standard-2022";

const props = defineProps<{
  points: GrowthPoint[];
  label: string;
  unit: string;
  corrected?: boolean;
  /** 填了性别才画标准参考线；没填时只画家长自己的测量点。 */
  sex?: GrowthSex;
  metric?: GrowthMetricId;
}>();

const WIDTH = 320;
const HEIGHT = 156;
const PAD = { left: 34, right: 10, top: 12, bottom: 26 };

const selectedIndex = ref<number | null>(null);
watch(
  () => props.points,
  () => {
    selectedIndex.value = null;
  },
);

const xMax = computed(() =>
  Math.max(6, ...props.points.map((point) => point.months)),
);

const reference = computed(() =>
  props.sex && props.metric
    ? referenceLines(props.sex, props.metric, xMax.value)
    : [],
);

const linePath = (points: Array<{ months: number; value: number }>) =>
  points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${x(point.months).toFixed(1)},${y(point.value).toFixed(1)}`,
    )
    .join(" ");

const bounds = computed(() => {
  const values = [
    ...props.points.map((point) => point.value),
    ...reference.value.flatMap((line) =>
      line.points.map((point) => point.value),
    ),
  ];
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.5, max - min);
  return { min: min - span * 0.15, max: max + span * 0.15 };
});

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

const path = computed(() => linePath(props.points));

const activeIdx = computed(() =>
  selectedIndex.value !== null && props.points[selectedIndex.value]
    ? selectedIndex.value
    : props.points.length - 1,
);
const activePoint = computed(() => props.points[activeIdx.value]);
const deltaLabel = computed(() => {
  const idx = activeIdx.value;
  if (idx <= 0 || !props.points[idx] || !props.points[idx - 1]) return "";
  const diff = round(props.points[idx]!.value - props.points[idx - 1]!.value);
  if (diff === 0) return "与上次持平";
  return `较上次 ${diff > 0 ? `+${diff}` : diff} ${props.unit}`;
});
const bandLabel = computed(() =>
  activePoint.value && props.sex && props.metric
    ? percentileBand(
        props.sex,
        props.metric,
        activePoint.value.months,
        activePoint.value.value,
      )
    : null,
);

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
      :aria-label="`${label}随月龄变化的折线图，共 ${points.length} 个记录点${reference.length ? '，附国标百分位参考线' : ''}`"
    >
      <text :x="PAD.left - 4" :y="PAD.top + 6" class="y-tick" text-anchor="end">
        {{ round(bounds.max) }}
      </text>
      <text
        :x="PAD.left - 4"
        :y="HEIGHT - PAD.bottom"
        class="y-tick"
        text-anchor="end"
      >
        {{ round(bounds.min) }}
      </text>
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
      <path
        v-for="line in reference"
        :key="line.percentile"
        :d="linePath(line.points)"
        :class="['ref-line', { median: line.percentile === 50 }]"
      />
      <path :d="path" class="series" />
      <circle
        v-for="(point, idx) in points"
        :key="point.date"
        :cx="x(point.months)"
        :cy="y(point.value)"
        :r="idx === activeIdx ? 4.8 : 3.4"
        class="dot"
        @click="selectedIndex = idx"
      />
    </svg>
    <div class="axis-labels">
      <span>0 月</span>
      <span>{{ round(xMax) }} 月</span>
    </div>
    <p v-if="reference.length" class="chart-legend">
      虚线为 WS/T 423—2022 的 P3 / P25 / P50 / P75 / P97 参考线（按{{
        sex === "female" ? "女童" : "男童"
      }}表），实线是你记录的点。
    </p>
    <p v-else class="chart-legend">
      在家庭页填写性别后，可叠加国标百分位参考线。
    </p>
    <p v-if="activePoint" class="chart-last">
      {{ selectedIndex !== null ? "选中" : "最近" }}：{{
        formatDate(activePoint.date)
      }}（{{ round(activePoint.months) }} 月龄）· {{ activePoint.value }}
      {{ unit }}<template v-if="deltaLabel"> · {{ deltaLabel }}</template>
    </p>
    <p v-if="bandLabel" class="chart-last">
      按同月龄同性别参考表：{{ bandLabel }}。只描述数据，具体请以医生为准。
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
.ref-line {
  fill: none;
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  opacity: 0.45;
}
.ref-line.median {
  stroke-width: 1.4;
  opacity: 0.75;
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
  cursor: pointer;
}
.y-tick {
  fill: var(--muted);
  font-size: 9px;
}
.axis-labels {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
}
.chart-legend,
.chart-last {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
</style>
