<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Play, Square } from "@lucide/vue";
import {
  elapsedSeconds,
  feedingSideMinutes,
  formatClock,
  type ActiveTimer,
  type TimerSide,
} from "../domain/timer";
import { QUICK_ACTIONS, type QuickKind } from "../domain/quick";
import { formatTime } from "../domain/date";

const props = withDefaults(
  defineProps<{
    timer: ActiveTimer | null;
    recent?: { id: string; label: string; at: string } | null;
    night?: boolean;
  }>(),
  { night: false, recent: null },
);
const emit = defineEmits<{
  quick: [kind: QuickKind];
  undo: [id: string];
  edit: [id: string];
  manualSleep: [asleep: string, awake: string];
  start: [side: TimerSide];
  switch: [side: TimerSide];
  finish: [];
  cancel: [];
}>();

const manualSleepOpen = ref(false);
const asleepTime = ref("");
const awakeTime = ref("");

function submitManualSleep() {
  if (!asleepTime.value || !awakeTime.value || asleepTime.value === awakeTime.value)
    return;
  emit("manualSleep", asleepTime.value, awakeTime.value);
  manualSleepOpen.value = false;
  asleepTime.value = "";
  awakeTime.value = "";
}

const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
const started = computed(() => props.timer !== null);

function tick() {
  now.value = Date.now();
}
function syncTicker() {
  clearInterval(ticker);
  // 只在计时进行时每秒刷新，避免空转；开始时先取一次真实当前时间，
  // 否则会沿用组件挂载时的旧值，第一秒显示不出正确的 00:00。
  if (started.value) {
    tick();
    ticker = setInterval(tick, 1000);
  }
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
  props.timer ? feedingSideMinutes(props.timer, new Date(now.value)) : null,
);
const runningLabel = computed(() => {
  const timer = props.timer;
  if (!timer) return "";
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
      <h2>记一次</h2>
      <button
        class="link-button"
        type="button"
        @click="manualSleepOpen = !manualSleepOpen"
      >
        {{ manualSleepOpen ? "收起补记" : "补记一觉" }}
      </button>
    </div>
    <div class="quick-actions">
      <button
        v-for="action in QUICK_ACTIONS"
        :key="action.id"
        class="quick-button"
        type="button"
        @click="emit('quick', action.id)"
      >
        {{ action.label }}
      </button>
    </div>
    <form
      v-if="manualSleepOpen"
      class="manual-sleep-form"
      @submit.prevent="submitManualSleep"
    >
      <div class="manual-sleep-fields">
        <label class="field"
          ><span>几点睡着</span
          ><input v-model="asleepTime" type="time" required
        /></label>
        <label class="field"
          ><span>几点醒来</span
          ><input v-model="awakeTime" type="time" required
        /></label>
      </div>
      <div class="manual-sleep-actions">
        <button
          class="button button-primary small"
          type="submit"
          :disabled="!asleepTime || !awakeTime || asleepTime === awakeTime"
        >
          保存这觉
        </button>
        <button
          class="button button-ghost small"
          type="button"
          @click="manualSleepOpen = false"
        >
          取消
        </button>
      </div>
    </form>
    <p v-if="recent" class="quick-undo" role="status">
      已记下 {{ recent.label }} · {{ formatTime(recent.at) }}
      <button class="link-button" type="button" @click="emit('edit', recent.id)">
        补充详情
      </button>
      <button class="link-button" type="button" @click="emit('undo', recent.id)">
        撤销
      </button>
    </p>

    <div class="timer-block">
      <div class="quick-head">
        <h2>计时</h2>
        <span v-if="!timer">亲喂分侧计时，睡觉用「记一次 / 补记一觉」</span>
      </div>
      <div v-if="!timer" class="timer-starts">
        <button
          class="button button-secondary"
          type="button"
          @click="emit('start', 'left')"
        >
          <Play :size="15" aria-hidden="true" />亲喂 · 左
        </button>
        <button
          class="button button-secondary"
          type="button"
          @click="emit('start', 'right')"
        >
          <Play :size="15" aria-hidden="true" />亲喂 · 右
        </button>
      </div>
      <div v-else class="timer-running" role="status" aria-live="polite">
        <p class="timer-clock">{{ clock }}</p>
        <p class="timer-meta">{{ runningLabel }}</p>
        <div class="timer-actions">
          <button
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
          <button
            class="button button-ghost"
            type="button"
            @click="emit('cancel')"
          >
            放弃
          </button>
        </div>
        <p class="timer-hint">结束时先给你一条草稿，确认后才会存档。</p>
      </div>
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
  align-items: baseline;
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
.quick-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.quick-button {
  min-height: 56px;
  padding: 8px 4px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--tint);
  color: var(--ink);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.quick-button:active {
  background: var(--line);
}
.quick-undo {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
.manual-sleep-form {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
}
.manual-sleep-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.manual-sleep-actions {
  display: flex;
  gap: 8px;
}
.link-button {
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--font-xs);
  text-decoration: underline;
  cursor: pointer;
}
.timer-block {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
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
.night-mode .quick-button {
  min-height: 68px;
  font-size: 17px;
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
  .quick-actions {
    gap: 6px;
  }
  .quick-button {
    min-height: 52px;
    font-size: 14px;
  }
  .timer-starts .button {
    min-width: 88px;
    font-size: 13px;
  }
}
</style>
