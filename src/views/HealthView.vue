<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { CalendarPlus, Check, Plus, Trash2 } from "@lucide/vue";
import type {
  BabyProfile,
  VaccinationRecord,
  VaccinePlan,
} from "../types";
import {
  STATUS_LABELS,
  summarizeVaccines,
  vaccineTasks,
  type VaccineStatus,
  type VaccineTask,
} from "../domain/vaccines";
import { VACCINE_SOURCE } from "../data/vaccines-2026";
import { localDate } from "../domain/date";

const props = defineProps<{
  baby: BabyProfile;
  plan: VaccinePlan;
  records: VaccinationRecord[];
  busy: boolean;
}>();
const emit = defineEmits<{
  savePlan: [plan: VaccinePlan];
  addRecord: [record: Omit<VaccinationRecord, "id" | "createdAt">];
  removeRecord: [id: string];
  calendar: [task: VaccineTask];
}>();

const today = localDate();
const filter = ref<"todo" | "all" | "done">("todo");
const editing = ref("");
const form = reactive({ date: today, clinic: "", lot: "" });
const custom = reactive({ name: "", date: today });

const tasks = computed(() =>
  vaccineTasks(props.baby, props.plan, props.records, today),
);
const summary = computed(() => summarizeVaccines(tasks.value));
const visible = computed(() => {
  if (filter.value === "done")
    return tasks.value.filter((item) => item.status === "done");
  if (filter.value === "all") return tasks.value;
  return tasks.value.filter(
    (item) => item.status === "overdue" || item.status === "due-soon",
  );
});
const customRecords = computed(() =>
  props.records
    .filter((item) => item.code === "custom")
    .sort((a, b) => b.date.localeCompare(a.date)),
);

function key(task: VaccineTask) {
  return `${task.code}-${task.dose}`;
}

function fullDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function statusClass(status: VaccineStatus) {
  return `pill-${status}`;
}

function startRecord(task: VaccineTask) {
  editing.value = key(task);
  form.date = today;
  form.clinic = "";
  form.lot = "";
}

function save(task: VaccineTask) {
  if (!form.date) return;
  emit("addRecord", {
    code: task.code,
    name: task.name,
    dose: task.dose,
    date: form.date,
    clinic: form.clinic.trim() || undefined,
    lot: form.lot.trim() || undefined,
  });
  editing.value = "";
}

function remove(record?: VaccinationRecord) {
  if (record) emit("removeRecord", record.id);
}

function addToCalendar(task: VaccineTask) {
  emit("calendar", task);
}

function addCustom() {
  const name = custom.name.trim();
  if (!name || !custom.date) return;
  emit("addRecord", {
    code: "custom",
    name,
    dose: 1,
    date: custom.date,
  });
  custom.name = "";
  custom.date = today;
}

function chooseSide(group: "je" | "hepa", code?: string) {
  const choices = { ...props.plan.choices };
  if (group === "je")
    choices.je = code as VaccinePlan["choices"]["je"];
  else choices.hepa = code as VaccinePlan["choices"]["hepa"];
  if (!code) delete choices[group === "je" ? "je" : "hepa"];
  emit("savePlan", { ...props.plan, choices });
}

function toggleSpecial(event: Event) {
  emit("savePlan", {
    ...props.plan,
    specialProgram: (event.target as HTMLInputElement).checked,
  });
}
</script>

<template>
  <section class="page health-page" aria-labelledby="health-heading">
    <div class="page-heading-row">
      <div>
        <p class="eyebrow">HEALTH RECORD</p>
        <h1 id="health-heading" class="page-heading">健康档案</h1>
        <p class="muted page-lede">
          接种计划按免疫程序推算，记录只存在本机，随备份一起走。
        </p>
      </div>
    </div>

    <div v-if="!baby.birthDate" class="notice" role="status">
      还没有填写出生日期，无法推算接种时间。<a href="#family">去家庭页填写</a>
    </div>

    <section v-if="baby.birthDate" class="vaccine-card surface">
      <header class="vaccine-head">
        <div>
          <h2 class="section-heading">疫苗计划</h2>
          <p class="muted">
            已记录 {{ summary.done }} / {{ summary.total }} 剂<template
              v-if="summary.overdue"
            >
              · 已过期未种 {{ summary.overdue }} 剂</template
            ><template v-if="summary.dueSoon">
              · 30 天内 {{ summary.dueSoon }} 剂</template
            >
          </p>
        </div>
      </header>

      <div class="plan-options">
        <label class="check-field">
          <input
            type="checkbox"
            :checked="plan.specialProgram"
            @change="toggleSpecial"
          />
          乙肝特殊程序（母亲 HBsAg 阳性且出生体重 &lt;2000g，按 0/1/2/7 月龄）
        </label>
        <div class="choice-row" role="group" aria-label="乙脑疫苗选择">
          <span>乙脑</span>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="!plan.choices.je"
            @click="chooseSide('je')"
          >
            待定
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.je === 'JE-L'"
            @click="chooseSide('je', 'JE-L')"
          >
            减毒活
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.je === 'JE-I'"
            @click="chooseSide('je', 'JE-I')"
          >
            灭活
          </button>
        </div>
        <div class="choice-row" role="group" aria-label="甲肝疫苗选择">
          <span>甲肝</span>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="!plan.choices.hepa"
            @click="chooseSide('hepa')"
          >
            待定
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.hepa === 'HepA-L'"
            @click="chooseSide('hepa', 'HepA-L')"
          >
            减毒活
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.hepa === 'HepA-I'"
            @click="chooseSide('hepa', 'HepA-I')"
          >
            灭活
          </button>
        </div>
      </div>

      <div class="filter-tabs" aria-label="疫苗筛选">
        <button
          type="button"
          :class="['filter-tab', { active: filter === 'todo' }]"
          :aria-pressed="filter === 'todo'"
          @click="filter = 'todo'"
        >
          待办
        </button>
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
          :class="['filter-tab', { active: filter === 'done' }]"
          :aria-pressed="filter === 'done'"
          @click="filter = 'done'"
        >
          已接种
        </button>
      </div>

      <ul v-if="visible.length" class="dose-list">
        <li
          v-for="task in visible"
          :key="key(task)"
          class="dose-row"
          :data-status="task.status"
        >
          <div class="dose-main">
            <strong>{{ task.name }} · 第 {{ task.dose }} 剂</strong>
            <span class="muted"
              >应种 {{ fullDate(task.dueDate)
              }}<template v-if="task.note"> · {{ task.note }}</template></span
            >
            <span v-if="task.pendingChoice" class="choice-hint">
              二选一还没定：先在上面选乙脑 / 甲肝用哪一支
            </span>
            <span v-if="task.record" class="record-hint">
              已接种 {{ fullDate(task.record.date) }}<template
                v-if="task.record.clinic"
              >
                · {{ task.record.clinic }}</template
              ><template v-if="task.record.lot">
                · 批号 {{ task.record.lot }}</template
              >
            </span>
          </div>
          <span class="pill" :class="statusClass(task.status)">{{
            STATUS_LABELS[task.status]
          }}</span>
          <div class="dose-actions">
            <button
              v-if="!task.record"
              class="button button-secondary small"
              type="button"
              :disabled="busy"
              @click="startRecord(task)"
            >
              <Check :size="14" aria-hidden="true" />记一笔
            </button>
            <button
              v-else
              class="button button-ghost small"
              type="button"
              :disabled="busy"
              @click="remove(task.record)"
            >
              <Trash2 :size="14" aria-hidden="true" />撤销
            </button>
            <button
              class="button button-ghost small"
              type="button"
              :disabled="busy"
              @click="addToCalendar(task)"
            >
              <CalendarPlus :size="14" aria-hidden="true" />加到日历
            </button>
          </div>
          <div v-if="editing === key(task)" class="record-form">
            <label class="field"
              ><span>接种日期</span
              ><input v-model="form.date" type="date" :max="today"
            /></label>
            <label class="field"
              ><span>门诊 <small>可选</small></span
              ><input v-model="form.clinic" maxlength="30" placeholder="例如：社区接种门诊"
            /></label>
            <label class="field"
              ><span>批号 <small>可选</small></span
              ><input v-model="form.lot" maxlength="30"
            /></label>
            <div class="record-actions">
              <button
                class="button button-primary small"
                type="button"
                :disabled="busy || !form.date"
                @click="save(task)"
              >
                保存
              </button>
              <button
                class="button button-ghost small"
                type="button"
                @click="editing = ''"
              >
                取消
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="empty-hint">
        {{ filter === "todo" ? "近期没有待接种的剂次。" : "这一栏还没有记录。" }}
      </p>

      <p class="source-line">{{ VACCINE_SOURCE }}</p>
    </section>

    <section class="custom-card surface">
      <h2 class="section-heading">自费疫苗</h2>
      <p class="muted custom-hint">
        13 价肺炎、轮状、水痘、流感等不在免疫规划里，可以自己记一笔。
      </p>
      <form class="custom-form" @submit.prevent="addCustom">
        <label class="field"
          ><span>疫苗名称</span
          ><input v-model="custom.name" maxlength="30" placeholder="例如：13 价肺炎"
        /></label>
        <label class="field"
          ><span>接种日期</span
          ><input v-model="custom.date" type="date" :max="today"
        /></label>
        <button
          class="button button-secondary"
          type="submit"
          :disabled="busy || !custom.name.trim()"
        >
          <Plus :size="15" aria-hidden="true" />添加
        </button>
      </form>
      <ul v-if="customRecords.length" class="custom-list">
        <li v-for="item in customRecords" :key="item.id">
          <span>{{ item.name || "自费疫苗" }}</span>
          <span class="muted">{{ fullDate(item.date) }}</span>
          <button
            class="button button-ghost small"
            type="button"
            :disabled="busy"
            @click="remove(item)"
          >
            删除
          </button>
        </li>
      </ul>
      <p v-else class="empty-hint">还没有自费疫苗记录。</p>
    </section>
  </section>
</template>

<style scoped>
.health-page {
  display: grid;
  gap: 22px;
}
.vaccine-card,
.custom-card {
  display: grid;
  gap: 14px;
  padding: 18px 16px;
}
.vaccine-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.vaccine-head h2 {
  margin: 0 0 4px;
}
.plan-options {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  background: var(--tint);
}
.choice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--font-xs);
  color: var(--muted);
}
.choice-button {
  min-height: 36px;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: var(--font-xs);
  cursor: pointer;
}
.choice-button[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--surface);
}
.filter-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.filter-tab {
  min-height: 40px;
  padding: 6px 14px;
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
.dose-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dose-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.dose-row[data-status="overdue"] .dose-main strong {
  color: var(--danger);
}
.dose-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.dose-main strong {
  font-size: 14px;
  font-weight: 600;
}
.dose-main .muted,
.record-hint,
.choice-hint {
  font-size: var(--font-xs);
  line-height: 1.6;
}
.record-hint {
  color: var(--accent);
}
.choice-hint {
  color: var(--muted);
  font-style: italic;
}
.dose-actions {
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
.record-form {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
}
.record-actions {
  display: flex;
  gap: 8px;
}
.source-line {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.custom-form {
  display: grid;
  gap: 10px;
}
.custom-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.custom-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.custom-list li span:first-child {
  flex: 1;
  min-width: 0;
}
.empty-hint {
  margin: 0;
  padding: 10px 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
.pill-done {
  background: var(--sage);
  color: var(--sage-ink);
}
.pill-overdue {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}
.pill-due-soon {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.pill-upcoming {
  background: var(--tint);
  color: var(--muted);
}
@media (min-width: 720px) {
  .custom-form {
    grid-template-columns: 1fr 180px auto;
    align-items: end;
  }
}
</style>
