<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Moon, Play, Square } from "@lucide/vue";
import {
  elapsedSeconds,
  feedingSideMinutes,
  formatClock,
  type ActiveTimer,
  type TimerKind,
  type TimerSide,
} from "../domain/timer";
import { formatTime } from "../domain/date";

const props = withDefaults(
  defineProps<{ timer: ActiveTimer | null; night?: boolean }>(),
  { night: false },
);
const emit = defineEmits<{
  start: [kind: TimerKind, side?: TimerSide];
  switch: [side: TimerSide];
  finish: [];
  cancel: [];
}>();

const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
const started = computed(() => props.timer !== null);

function tick() {
  now.value = Date.now();
}
function syncTicker() {
  clearInterval(ticker);
  // 只在计时进行时每秒刷新，避免空转。
  if (started.value) ticker = setInterval(tick, 1000);
}
onMounted(syncTicker);
onBeforeUnmount(() => clearInterval(ticker));
// 计时开始或结束时切换每秒刷新。
watch(started, syncTicker);

const elapsed = computed(() =>
  props.timer ? elapsedSeconds(props.timer, new Date(now.value)) : 0,
);
const clock = computed(() => formatClock(elapsed.value));
const sides = computed(() =>
  props.timer?.kind === "feeding"
    ? feedingSideMinutes(props.timer, new Date(now.value))
    : null,
);
const runningLabel = computed(() => {
  const timer = props.timer;
  if (!timer) return "";
  if (timer.kind === "sleep")
    return `睡眠中 · ${formatTime(timer.startedAt)} 开始`;
  const side = timer.side === "right" ? "右" : "左";
  const parts = sides.value
    ? [
        sides.value.left ? `左 ${sides.value.left} 分` : "",
        sides.value.right ? `右 ${sides.value.right} 分` : "",
      ].filter(Boolean)
    : [];
  return `亲喂中 · ${side}侧 · ${formatTime(timer.startedAt)} 开始${parts.length ? `（${parts.join(" · ")}）` : ""}`;
});
const otherSide = computed<TimerSide>(() =>
  props.timer?.side === "left" ? "right" : "left",
);
</script>

<template>
  <section class="quick-log" :class="{ 'night-mode': props.night }">
    <div class="quick-head">
      <h2>计时</h2>
      <span v-if="!timer">记不准时长时，用计时</span>
    </div>
    <div v-if="!timer" class="timer-starts">
      <button
        class="button button-secondary"
        type="button"
        @click="emit('start', 'feeding', 'left')"
      >
        <Play :size="15" aria-hidden="true" />亲喂 · 左
      </button>
      <button
        class="button button-secondary"
        type="button"
        @click="emit('start', 'feeding', 'right')"
      >
        <Play :size="15" aria-hidden="true" />亲喂 · 右
      </button>
      <button
        class="button button-secondary"
        type="button"
        @click="emit('start', 'sleep')"
      >
        <Moon :size="15" aria-hidden="true" />开始睡觉
      </button>
    </div>
    <div v-else class="timer-running" role="status" aria-live="polite">
      <p class="timer-clock">{{ clock }}</p>
      <p class="timer-meta">{{ runningLabel }}</p>
      <div class="timer-actions">
        <button
          v-if="timer.kind === 'feeding'"
          class="button button-secondary"
          type="button"
          @click="emit('switch', otherSide)"
        >
          换到{{ otherSide === 'right' ? '右' : '左' }}边
        </button>
        <button
          class="button button-primary"
          type="button"
          @click="emit('finish')"
        >
          <Square :size="14" aria-hidden="true" />结束并记录
        </button>
        <button class="button button-ghost" type="button" @click="emit('cancel')">
          放弃
        </button>
      </div>
      <p class="timer-hint">结束时先给你一条草稿，确认后才会存档。</p>
    </div>
  </section>
</template>

<style scoped>
.quick-log {
  display: grid;
  gap: 12px;
  padding: 16px 15px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  min-width: 0;
}
.quick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.quick-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.quick-head span {
  color: var(--muted);
  font-size: var(--font-xs);
}
.timer-starts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.timer-starts .button {
  flex: 1 1 auto;
  min-width: 96px;
}
.timer-running {
  display: grid;
  gap: 8px;
}
.timer-clock {
  margin: 0;
  font-size: clamp(30px, 9vw, 40px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  color: var(--ink);
}
.timer-meta {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.6;
}
.timer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.timer-actions .button {
  flex: 1 1 auto;
  min-width: 104px;
}
.timer-hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.night-mode .timer-starts .button,
.night-mode .timer-actions .button {
  min-height: 54px;
  font-size: 15px;
}
@media (max-width: 400px) {
  .quick-log {
    padding: 14px 12px;
  }
  .timer-starts .button {
    min-width: 88px;
    font-size: 13px;
  }
}
</style>
