<script setup lang="ts">
import { computed, ref } from "vue";
import { Printer, X } from "@lucide/vue";
import type {
  BabyProfile,
  VaccinationRecord,
  VaccinePlan,
} from "../types";
import { pendingVaccinesOn } from "../domain/vaccines";
import { localDate, formatDate } from "../domain/date";
import { SCHOOL_CHECK_COPY, SCHOOL_CHECK_SOURCE } from "../data/school-check-cn";

const props = defineProps<{
  baby: BabyProfile;
  plan: VaccinePlan;
  records: VaccinationRecord[];
  /** 折进健康页的统一卡片时隐藏自己的标题行。 */
  embedded?: boolean;
}>();

const targetDate = ref(localDate());
const items = computed(() =>
  pendingVaccinesOn(props.baby, props.plan, props.records, targetDate.value),
);
const hasPendingChoice = computed(() =>
  items.value.some((item) => item.pendingChoice),
);
const printOpen = ref(false);

function printSheet() {
  window.print();
}
</script>

<template>
  <section class="school-card surface" aria-labelledby="school-check-heading">
    <h2 v-if="embedded" id="school-check-heading" class="visually-hidden">
      {{ SCHOOL_CHECK_COPY.title }}
    </h2>
    <header v-else class="school-head">
      <div>
        <h2 id="school-check-heading" class="section-heading">
          {{ SCHOOL_CHECK_COPY.title }}
        </h2>
        <p class="muted">{{ SCHOOL_CHECK_COPY.intro }}</p>
      </div>
    </header>
    <div class="school-print-row">
      <button class="button button-ghost small" type="button" @click="printOpen = true">
        <Printer :size="15" aria-hidden="true" />{{ SCHOOL_CHECK_COPY.print }}
      </button>
    </div>

    <label class="field school-date">
      <span>{{ SCHOOL_CHECK_COPY.dateLabel }}</span>
      <input v-model="targetDate" type="date" />
    </label>

    <p class="school-count">{{ SCHOOL_CHECK_COPY.count(items.length) }}</p>
    <p v-if="hasPendingChoice" class="school-hint">
      {{ SCHOOL_CHECK_COPY.pendingChoice }}
    </p>

    <ul v-if="items.length" class="school-list">
      <li v-for="item in items" :key="`${item.code}-${item.dose}`">
        <div class="school-item-main">
          <strong>{{ item.name }} · 第 {{ item.dose }} 剂</strong>
          <span class="muted">应种 {{ item.dueDate }}</span>
        </div>
        <span v-if="item.pendingChoice" class="school-pill">待选</span>
      </li>
    </ul>
    <p v-else class="empty-hint">{{ SCHOOL_CHECK_COPY.empty }}</p>

    <p class="school-note">{{ SCHOOL_CHECK_COPY.scope }}</p>
    <p class="school-note">{{ SCHOOL_CHECK_COPY.limits }}</p>
    <p class="school-note">{{ SCHOOL_CHECK_COPY.timing }}</p>
    <p class="school-note">{{ SCHOOL_CHECK_COPY.note }}</p>
    <p class="school-note">依据：{{ SCHOOL_CHECK_SOURCE }}。</p>

    <Teleport to="body">
      <section
        v-if="printOpen"
        class="school-check-sheet"
        aria-labelledby="school-sheet-heading"
      >
        <header class="sheet-head">
          <div>
            <p class="eyebrow">VACCINATION CHECK</p>
            <h2 id="school-sheet-heading">{{ SCHOOL_CHECK_COPY.sheetTitle }}</h2>
            <p class="muted">
              {{ baby.name || "宝宝" }} · 目标日期 {{ formatDate(targetDate) }} ·
              {{ SCHOOL_CHECK_COPY.count(items.length) }}
            </p>
          </div>
          <div class="sheet-actions">
            <button class="button button-primary" type="button" @click="printSheet">
              <Printer :size="16" aria-hidden="true" />{{ SCHOOL_CHECK_COPY.print }}
            </button>
            <button class="icon-button" type="button" aria-label="关闭核对单" @click="printOpen = false">
              <X :size="19" />
            </button>
          </div>
        </header>

        <div class="sheet-body">
          <table v-if="items.length" class="sheet-table">
            <thead>
              <tr><th>疫苗</th><th>剂次</th><th>应种日期</th><th>备注</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="`${item.code}-${item.dose}`">
                <td>{{ item.name }}</td>
                <td>第 {{ item.dose }} 剂</td>
                <td>{{ item.dueDate }}</td>
                <td>{{ item.pendingChoice ? "二选一待选" : "" }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">{{ SCHOOL_CHECK_COPY.empty }}</p>
          <p class="sheet-note">{{ SCHOOL_CHECK_COPY.scope }}</p>
          <p class="sheet-note">{{ SCHOOL_CHECK_COPY.limits }}</p>
          <p class="sheet-note">{{ SCHOOL_CHECK_COPY.note }}</p>
          <p class="sheet-note">依据：{{ SCHOOL_CHECK_SOURCE }}。</p>
        </div>
      </section>
    </Teleport>
  </section>
</template>

<style scoped>
.school-card {
  display: grid;
  gap: 12px;
  padding: 18px 16px;
}
.school-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.school-head h2 {
  margin: 0 0 4px;
}
.school-print-row {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.button.small {
  min-height: 38px;
  padding: 6px 12px;
  font-size: var(--font-xs);
}
.school-date {
  max-width: 100%;
}
.school-date input[type="date"] {
  appearance: none;
  min-width: 0;
}
.school-count {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.school-hint,
.school-note,
.empty-hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.empty-hint {
  padding: 8px 0;
}
.school-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.school-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.school-item-main {
  display: grid;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.school-item-main .muted {
  font-size: var(--font-xs);
}
.school-pill {
  flex: none;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--tint);
  color: var(--muted);
  font-size: var(--font-xs);
}
.school-check-sheet {
  position: fixed;
  inset: 0;
  z-index: 45;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg);
}
.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 780px;
  margin: 0 auto 18px;
}
.sheet-head h2 {
  margin: 0 0 4px;
  font-size: 22px;
}
.sheet-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sheet-body {
  max-width: 780px;
  margin: 0 auto;
  display: grid;
  gap: 14px;
  padding-bottom: 40px;
}
.sheet-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.sheet-table th,
.sheet-table td {
  padding: 7px 6px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.sheet-table th {
  color: var(--muted);
  font-weight: 400;
  font-size: var(--font-xs);
}
.sheet-note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
</style>
