<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { CalendarPlus, Check, Trash2 } from "@lucide/vue";
import type { BabyProfile, HealthCheckRecord } from "../types";
import {
  HEALTH_CHECK_FOOTNOTE,
  HEALTH_CHECK_RISK_NOTE,
  HEALTH_CHECK_SOURCE,
  HEALTH_CHECK_SOURCE_URL,
} from "../data/child-health-checks";
import {
  HEALTH_CHECK_STATUS_LABELS,
  cancelHealthCheck,
  completeHealthCheck,
  healthCheckTasks,
} from "../domain/health-checks";
import { localDate } from "../domain/date";
import {
  buildHealthCheckIcs,
  healthCheckIcsFileName,
} from "../lib/ics";
import { downloadBlob } from "../lib/export";

const props = defineProps<{
  baby: BabyProfile;
  records: Record<string, HealthCheckRecord>;
  busy: boolean;
  /** 折进健康页的统一卡片时隐藏自己的标题行。 */
  embedded?: boolean;
}>();
const emit = defineEmits<{
  save: [records: Record<string, HealthCheckRecord>];
}>();

const today = localDate();
const tasks = computed(() => healthCheckTasks(props.baby, props.records, today));
const editing = ref("");
const form = reactive({ date: today, place: "", note: "", teethCount: "" });

function fullDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function startRecord(id: string, dueDate?: string) {
  editing.value = id;
  form.date = dueDate && dueDate <= today ? dueDate : today;
  form.place = "";
  form.note = "";
  form.teethCount = "";
}

function save(id: string) {
  if (!form.date) return;
  const record: HealthCheckRecord = {
    date: form.date,
    ...(form.place.trim() ? { place: form.place.trim() } : {}),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
    ...(form.teethCount !== ""
      ? { teethCount: Math.max(0, Math.round(Number(form.teethCount) || 0)) }
      : {}),
  };
  emit("save", completeHealthCheck(props.records, id, record));
  editing.value = "";
}

function cancel(id: string) {
  emit("save", cancelHealthCheck(props.records, id));
  if (editing.value === id) editing.value = "";
}

function addToCalendar(id: string, name: string, dueDate?: string) {
  if (!dueDate) return;
  const event = { id, name, dueDate };
  downloadBlob(
    new Blob([buildHealthCheckIcs(event)], { type: "text/calendar;charset=utf-8" }),
    healthCheckIcsFileName(event),
  );
}
</script>

<template>
  <section class="health-check-card surface" aria-labelledby="health-checks-heading">
    <h2 v-if="embedded" id="health-checks-heading" class="visually-hidden">体检日程</h2>
    <header v-else class="hc-head">
      <div>
        <h2 id="health-checks-heading" class="section-heading">体检日程</h2>
        <p class="muted">
          0～6 岁共 13 次儿童健康管理；已完成
          {{ tasks.filter((item) => item.status === "done").length }} 次。
        </p>
      </div>
    </header>

    <p v-if="!baby.birthDate" class="empty-hint">
      还没有填写出生日期，无法推算体检的参考时间。
    </p>
    <ul v-else class="hc-list">
      <li v-for="task in tasks" :key="task.node.id" class="hc-row" :data-status="task.status">
        <div class="hc-main">
          <strong>{{ task.node.label }}</strong>
          <span class="muted hc-timing">
            {{ task.node.timing }}<template v-if="task.dueDate">
              · 参考 {{ fullDate(task.dueDate) }}</template
            >
          </span>
          <span v-if="task.record" class="hc-record-hint">
            已完成 {{ fullDate(task.record.date) }}<template v-if="task.record.place">
              · {{ task.record.place }}</template
            ><template v-if="task.record.teethCount !== undefined">
              · 出牙 {{ task.record.teethCount }} 颗</template
            ><template v-if="task.record.note"> · {{ task.record.note }}</template>
          </span>
          <span class="hc-items">
            <span v-for="item in task.node.items" :key="item.id" class="hc-item"
              >{{ item.label }}<template v-if="item.note">（{{ item.note }}）</template></span
            >
          </span>
        </div>
        <span class="hc-pill" :data-status="task.status">{{ HEALTH_CHECK_STATUS_LABELS[task.status] }}</span>
        <div class="hc-actions">
          <button
            v-if="!task.record"
            class="button button-secondary small"
            type="button"
            :disabled="busy"
            @click="startRecord(task.node.id, task.dueDate)"
          >
            <Check :size="14" aria-hidden="true" />标记完成
          </button>
          <button
            v-else
            class="button button-ghost small"
            type="button"
            :disabled="busy"
            @click="cancel(task.node.id)"
          >
            <Trash2 :size="14" aria-hidden="true" />撤销
          </button>
          <button
            v-if="task.dueDate"
            class="button button-ghost small"
            type="button"
            :disabled="busy"
            @click="addToCalendar(task.node.id, task.node.label, task.dueDate)"
          >
            <CalendarPlus :size="14" aria-hidden="true" />加到日历
          </button>
        </div>
        <form
          v-if="editing === task.node.id"
          class="hc-form"
          @submit.prevent="save(task.node.id)"
        >
          <label class="field"
            ><span>体检日期</span
            ><input v-model="form.date" type="date" :max="today" required
          /></label>
          <label class="field"
            ><span>机构 <small>可选</small></span
            ><input v-model="form.place" maxlength="30" placeholder="例如：社区卫生服务中心"
          /></label>
          <label v-if="task.node.teethCount" class="field"
            ><span>出牙数 <small>可选，按实际填写</small></span
            ><input
              v-model="form.teethCount"
              type="number"
              min="0"
              max="40"
              step="1"
              inputmode="numeric"
              placeholder="例如：2"
          /></label>
          <label class="field"
            ><span>备注 <small>可选</small></span
            ><input v-model="form.note" maxlength="60" placeholder="想记下的话"
          /></label>
          <div class="hc-form-actions">
            <button class="button button-primary small" type="submit" :disabled="busy">
              保存
            </button>
            <button class="button button-ghost small" type="button" @click="editing = ''">
              取消
            </button>
          </div>
        </form>
      </li>
    </ul>

    <p class="hc-note">{{ HEALTH_CHECK_FOOTNOTE }}</p>
    <p class="hc-note">{{ HEALTH_CHECK_RISK_NOTE }}</p>
    <p class="hc-note">
      来源：<a :href="HEALTH_CHECK_SOURCE_URL" target="_blank" rel="noreferrer">{{
        HEALTH_CHECK_SOURCE
      }}</a
      >。这里只列服务时间与项目，不记录检查结果，具体请以医生为准。
    </p>
  </section>
</template>

<style scoped>
.health-check-card {
  display: grid;
  gap: 14px;
  padding: 18px 16px;
}
.hc-head h2 {
  margin: 0 0 4px;
}
.hc-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.hc-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.hc-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.hc-main strong {
  font-size: 14px;
  font-weight: 600;
}
.hc-timing,
.hc-record-hint {
  font-size: var(--font-xs);
  line-height: 1.6;
}
.hc-record-hint {
  color: var(--accent);
}
.hc-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.hc-item {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.7;
}
.hc-pill {
  align-self: start;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--tint);
  color: var(--muted);
  white-space: nowrap;
  font-size: var(--font-xs);
}
.hc-pill[data-status="done"] {
  background: var(--sage);
  color: var(--sage-ink);
}
.hc-pill[data-status="overdue"] {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}
.hc-pill[data-status="due-soon"] {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.hc-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.button.small {
  min-height: 38px;
  padding: 6px 12px;
  font-size: var(--font-xs);
}
.hc-form {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
}
.hc-form input[type="date"] {
  appearance: none;
  min-width: 0;
}
.hc-form-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.hc-note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.empty-hint {
  margin: 0;
  padding: 10px 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
</style>
