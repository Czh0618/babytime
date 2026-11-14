<script setup lang="ts">
import { Printer, X, FileDown } from "@lucide/vue";
import type { VisitSummaryData } from "../domain/summary";
import { formatDate, formatTime } from "../domain/date";
import { formatMinutes } from "../domain/sleep";

defineProps<{ babyName: string; summary: VisitSummaryData }>();
const emit = defineEmits<{ close: []; print: []; csv: [] }>();
</script>

<template>
  <section class="visit-sheet" aria-labelledby="visit-heading">
    <header class="visit-head">
      <div>
        <p class="eyebrow">VISIT SUMMARY</p>
        <h2 id="visit-heading">{{ babyName }} · 就诊摘要</h2>
        <p class="muted">
          {{ formatDate(summary.from) }} — {{ formatDate(summary.to) }} · 共
          {{ summary.entryCount }} 条记录
        </p>
      </div>
      <div class="visit-actions">
        <button class="button button-primary" type="button" @click="emit('print')">
          <Printer :size="16" aria-hidden="true" />打印 / 存为 PDF
        </button>
        <button class="button button-secondary" type="button" @click="emit('csv')">
          <FileDown :size="16" aria-hidden="true" />导出 CSV
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="关闭就诊摘要"
          @click="emit('close')"
        >
          <X :size="19" />
        </button>
      </div>
    </header>

    <div class="visit-body">
      <section class="visit-block">
        <h3>最近 {{ summary.days }} 天照护</h3>
        <dl class="visit-grid">
          <div>
            <dt>喂奶</dt>
            <dd>
              {{ summary.feedingCount }} 次 · 摄入 {{ summary.intakeMl }} ml
              <small v-if="summary.pumpedMl"
                >（另有吸出 {{ summary.pumpedMl }} ml）</small
              >
            </dd>
          </div>
          <div>
            <dt>睡眠</dt>
            <dd>{{ formatMinutes(summary.sleepMinutes) }}</dd>
          </div>
          <div>
            <dt>尿布</dt>
            <dd>
              {{ summary.diaperCount }} 次 · 尿湿 {{ summary.wetCount }} · 便便
              {{ summary.dirtyCount }}
            </dd>
          </div>
        </dl>
      </section>

      <section v-if="summary.growth" class="visit-block">
        <h3>最近一次生长测量</h3>
        <dl class="visit-grid">
          <div>
            <dt>测量时间</dt>
            <dd>
              {{ formatDate(summary.growth.date) }}
              {{ formatTime(summary.growth.date) }}
            </dd>
          </div>
          <div v-if="summary.growth.weightKg !== undefined">
            <dt>体重</dt>
            <dd>{{ summary.growth.weightKg }} kg</dd>
          </div>
          <div v-if="summary.growth.heightCm !== undefined">
            <dt>身高 / 身长</dt>
            <dd>{{ summary.growth.heightCm }} cm</dd>
          </div>
          <div v-if="summary.growth.headCm !== undefined">
            <dt>头围</dt>
            <dd>{{ summary.growth.headCm }} cm</dd>
          </div>
          <div v-if="summary.growth.bmi !== undefined">
            <dt>BMI（由同一次体重与身高派生）</dt>
            <dd>{{ summary.growth.bmi }} kg/m²</dd>
          </div>
        </dl>
        <ul v-if="summary.growth.bands.length" class="visit-band-list">
          <li v-for="band in summary.growth.bands" :key="band.label">
            {{ band.label }}：{{ band.text }}
          </li>
        </ul>
        <p class="muted">{{ summary.growth.note }}</p>
      </section>

      <section class="visit-block">
        <h3>体温记录</h3>
        <p v-if="!summary.temperature.length" class="muted">
          这段时间没有体温记录。
        </p>
        <table v-else class="visit-table">
          <thead>
            <tr><th>时间</th><th>记录</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in summary.temperature" :key="item.at">
              <td>{{ formatDate(item.at) }} {{ formatTime(item.at) }}</td>
              <td>{{ item.text }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="visit-block">
        <h3>用药记录</h3>
        <p v-if="!summary.medicines.length" class="muted">
          这段时间没有用药记录。
        </p>
        <table v-else class="visit-table">
          <thead>
            <tr><th>时间</th><th>记录</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in summary.medicines" :key="item.at">
              <td>{{ formatDate(item.at) }} {{ formatTime(item.at) }}</td>
              <td>{{ item.text }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="visit-block">
        <h3>疫苗状态</h3>
        <p class="muted">
          已记录 {{ summary.vaccines.done }} 剂 · 已过期未种
          {{ summary.vaccines.overdue }} 剂 · 30 天内
          {{ summary.vaccines.dueSoon }} 剂
        </p>
        <table v-if="summary.vaccines.upcoming.length" class="visit-table">
          <thead>
            <tr><th>疫苗</th><th>剂次</th><th>应种日期</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="item in summary.vaccines.upcoming"
              :key="`${item.name}-${item.dose}`"
            >
              <td>{{ item.name }}</td>
              <td>第 {{ item.dose }} 剂</td>
              <td>{{ item.dueDate }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p class="visit-note">
        本页由家长在本机记录的数据自动汇总，不是诊断，也不构成医疗建议。
        疫苗程序依据 2026 年版国家免疫规划，具体以接种门诊为准。
      </p>
    </div>
  </section>
</template>

<style scoped>
.visit-sheet {
  position: fixed;
  inset: 0;
  z-index: 40;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg);
}
.visit-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 780px;
  margin: 0 auto 18px;
}
.visit-head h2 {
  margin: 0 0 4px;
  font-size: 22px;
}
.visit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.visit-body {
  max-width: 780px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
  padding-bottom: 40px;
}
.visit-block {
  display: grid;
  gap: 8px;
}
.visit-block h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.visit-grid {
  display: grid;
  gap: 10px;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.visit-grid dt {
  color: var(--muted);
  font-size: var(--font-xs);
}
.visit-grid dd {
  margin: 2px 0 0;
  font-size: 14px;
  line-height: 1.6;
}
.visit-grid small {
  color: var(--muted);
  font-size: 12px;
}
.visit-band-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
}
.visit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.visit-table th,
.visit-table td {
  padding: 7px 6px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.visit-table th {
  color: var(--muted);
  font-weight: 400;
  font-size: var(--font-xs);
}
.visit-note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
@media (min-width: 720px) {
  .visit-sheet {
    padding: 32px;
  }
}
</style>
