<script setup lang="ts">
import { computed } from "vue";
import type { GrowthEntry, HealthCheckRecord } from "../types";
import { CHILD_HEALTH_CHECKS } from "../data/child-health-checks";
import {
  NEW_FOOD_OBSERVATION_NOTE,
  NEW_FOOD_SOURCE,
  NEW_FOOD_SOURCE_URL,
  NEW_FOOD_VERSION_NOTE,
  ORAL_CARE_FOOTNOTE,
  ORAL_CARE_TIPS,
  ORAL_SOURCE,
  ORAL_SOURCE_URL,
} from "../data/feeding-guide-cn";
import { firstFoodIntroductions } from "../domain/feeding-new-food";
import { formatDate } from "../domain/date";

const props = withDefaults(
  defineProps<{
    entries: GrowthEntry[];
    healthChecks?: Record<string, HealthCheckRecord>;
    /** 折进健康页的统一卡片时隐藏自己的标题行。 */
    embedded?: boolean;
  }>(),
  { healthChecks: () => ({}) },
);

const foods = computed(() => firstFoodIntroductions(props.entries));
/** 出牙数记在体检记录里，这里只读出来展示，不新增字段。 */
const teeth = computed(() =>
  CHILD_HEALTH_CHECKS.filter(
    (node) => node.teethCount && props.healthChecks[node.id]?.teethCount !== undefined,
  ).map((node) => ({
    label: node.label,
    count: props.healthChecks[node.id]!.teethCount!,
  })),
);
</script>

<template>
  <section class="feeding-card surface" aria-labelledby="feeding-notes-heading">
    <h2 v-if="embedded" id="feeding-notes-heading" class="visually-hidden">喂养与口腔</h2>
    <header v-else class="feeding-head">
      <div>
        <h2 id="feeding-notes-heading" class="section-heading">喂养与口腔</h2>
        <p class="muted">
          首次吃的食物由已有记录里的「吃了什么 / 不适或过敏」自动汇总；0～6 月龄与
          7～24 月龄的喂养准则在「今天」页的月龄卡里。
        </p>
      </div>
    </header>

    <div class="feeding-block">
      <h3>新食物引入</h3>
      <ul v-if="foods.length" class="feeding-list">
        <li v-for="item in foods" :key="item.name">
          <span class="feeding-date">{{ formatDate(item.date) }}</span>
          <span class="feeding-text"
            >{{ item.name }}<template v-if="item.reaction"> · {{ item.reaction }}</template></span
          >
        </li>
      </ul>
      <p v-else class="empty-hint">
        还没有记录过食物名称。在照护记录里写下「吃了什么」，这里会列出第一次吃的日期。
      </p>
      <p class="feeding-note">{{ NEW_FOOD_OBSERVATION_NOTE }}</p>
      <p class="feeding-note">{{ NEW_FOOD_VERSION_NOTE }}</p>
      <p class="feeding-note">
        原文出处：<a :href="NEW_FOOD_SOURCE_URL" target="_blank" rel="noreferrer">{{
          NEW_FOOD_SOURCE
        }}</a>
      </p>
    </div>

    <div class="feeding-block">
      <h3>口腔提示</h3>
      <ul class="feeding-list feeding-tips">
        <li v-for="tip in ORAL_CARE_TIPS" :key="tip">{{ tip }}</li>
      </ul>
      <p v-if="teeth.length" class="feeding-note">
        体检记录里的出牙数：{{ teeth.map((item) => `${item.label} ${item.count} 颗`).join(" · ") }}
      </p>
      <p class="feeding-note">{{ ORAL_CARE_FOOTNOTE }}</p>
      <p class="feeding-note">
        来源：<a :href="ORAL_SOURCE_URL" target="_blank" rel="noreferrer">{{ ORAL_SOURCE }}</a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.feeding-card {
  display: grid;
  gap: 14px;
  padding: 18px 16px;
}
.feeding-head h2 {
  margin: 0 0 4px;
}
.feeding-block {
  display: grid;
  gap: 8px;
}
.feeding-block h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.feeding-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.feeding-list li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.6;
}
.feeding-date {
  flex: none;
  color: var(--accent);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}
.feeding-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.feeding-tips li {
  display: block;
  border-bottom: 0;
  padding: 3px 0;
  font-size: 13px;
}
.feeding-note,
.empty-hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.empty-hint {
  padding: 8px 0;
}
</style>
