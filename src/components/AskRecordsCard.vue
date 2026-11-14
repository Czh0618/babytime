<script setup lang="ts">
import { computed, ref } from "vue";
import { Sparkles } from "@lucide/vue";
import type { BabyProfile, GrowthEntry } from "../types";
import { ageOn } from "../domain/age";
import { aggregateByDay, nightSummary } from "../domain/stats";
import { deriveSleepSegments } from "../domain/sleep";
import {
  MEDICAL_REPLY,
  QA_SYSTEM_PROMPT,
  buildQAUserPrompt,
  buildStatsDigest,
  guardMedicalOutput,
  isMedicalQuestion,
} from "../domain/ai";
import { aiChat, aiErrorMessage } from "../lib/ai-service";

const props = defineProps<{
  baby: BabyProfile;
  entries: GrowthEntry[];
  aiReady: boolean;
  /** 折进健康页的统一卡片时隐藏自己的标题行。 */
  embedded?: boolean;
}>();

const question = ref("");
const answer = ref("");
const busy = ref(false);
const error = ref("");
const usedAi = ref(false);
const canAsk = computed(() => question.value.trim().length > 0 && !busy.value);

/** 单轮问答：只发聚合统计，不存对话历史。 */
async function ask() {
  if (!canAsk.value) return;
  const text = question.value.trim();
  answer.value = "";
  error.value = "";
  usedAi.value = false;
  // 医疗类问题直接给固定回复，不消耗一次调用。
  if (isMedicalQuestion(text)) {
    answer.value = MEDICAL_REPLY;
    return;
  }
  if (!props.aiReady) {
    error.value = "还没有配置模型服务，先在「家庭 → AI 辅助整理」里设置。";
    return;
  }
  busy.value = true;
  try {
    const age = ageOn(props.baby.birthDate);
    const digest = buildStatsDigest(aggregateByDay(props.entries, 30), {
      ageMonths: age.valid ? age.months : undefined,
      night: nightSummary(
        props.entries,
        deriveSleepSegments(props.entries),
        new Date(),
      ),
    });
    const raw = await aiChat(QA_SYSTEM_PROMPT, buildQAUserPrompt(text, digest));
    answer.value = guardMedicalOutput(raw).text.slice(0, 500);
    usedAi.value = true;
  } catch (cause) {
    error.value = aiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="ask-card surface" aria-labelledby="ask-heading">
    <h2 v-if="embedded" id="ask-heading" class="visually-hidden">问问记录</h2>
    <h2 v-else id="ask-heading" class="section-heading">问问记录</h2>
    <p class="muted ask-hint">
      例如「最近睡得怎么样」「这周喂奶几次」。只发送按天汇总的数字，不保存对话，也不给医疗建议。
    </p>
    <form class="ask-form" @submit.prevent="ask">
      <input
        v-model="question"
        maxlength="120"
        placeholder="想问点什么…"
        aria-label="关于记录的问题"
      />
      <button class="button button-secondary" type="submit" :disabled="!canAsk">
        <Sparkles :size="15" aria-hidden="true" />{{
          busy ? "正在看记录…" : "问一下"
        }}
      </button>
    </form>
    <p v-if="answer" class="ask-answer">{{ answer }}</p>
    <p v-if="answer" class="ask-note">
      {{ usedAi ? "AI 只看到聚合统计，结果不保存。" : "固定回复，没有调用模型。" }}
    </p>
    <p v-if="error" class="ask-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.ask-card {
  display: grid;
  gap: 10px;
  padding: 18px 16px;
}
.ask-card h2 {
  margin: 0;
}
.ask-hint {
  margin: 0;
  font-size: var(--font-xs);
  line-height: 1.7;
}
.ask-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ask-form input {
  flex: 1 1 180px;
  min-height: 44px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: inherit;
  font-size: 14px;
}
.ask-form .button {
  min-height: 44px;
}
.ask-answer {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.ask-note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.ask-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.6;
}
</style>
