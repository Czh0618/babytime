<script setup lang="ts">
import { computed, ref } from "vue";
import { Sparkles, X } from "@lucide/vue";
import type { Anniversary } from "../domain/anniversary";
import { ANNIVERSARY_SYSTEM_PROMPT, guardMedicalOutput } from "../domain/ai";
import { aiChat, aiErrorMessage } from "../lib/ai-service";

const props = defineProps<{ anniversary: Anniversary; aiReady: boolean }>();
const emit = defineEmits<{ dismiss: [] }>();

const copy = ref("");
const busy = ref(false);
const error = ref("");
const shown = computed(() => copy.value || props.anniversary.detail);

async function writeCopy() {
  if (busy.value || !props.aiReady) return;
  busy.value = true;
  error.value = "";
  try {
    const raw = await aiChat(
      ANNIVERSARY_SYSTEM_PROMPT,
      `${props.anniversary.title}。${props.anniversary.detail}`,
    );
    copy.value = guardMedicalOutput(raw).text.slice(0, 60);
  } catch (cause) {
    error.value = aiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="anniversary" aria-labelledby="anniversary-title">
    <div class="anniversary-head">
      <div>
        <p class="eyebrow">A DAY TO REMEMBER</p>
        <h2 id="anniversary-title">{{ anniversary.title }}</h2>
        <p class="anniversary-copy">{{ shown }}</p>
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="今天不显示纪念日卡片"
        @click="emit('dismiss')"
      >
        <X :size="18" />
      </button>
    </div>
    <button
      v-if="aiReady && !copy"
      class="button button-ghost small"
      type="button"
      :disabled="busy"
      @click="writeCopy"
    >
      <Sparkles :size="14" aria-hidden="true" />{{
        busy ? "正在写…" : "让 AI 写一句"
      }}
    </button>
    <p v-if="error" class="anniversary-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.anniversary {
  display: grid;
  gap: 10px;
  padding: 18px 16px;
  border-radius: var(--radius);
  background: var(--tint);
}
.anniversary-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.anniversary h2 {
  margin: 2px 0 6px;
  font-size: 19px;
  font-weight: 500;
}
.anniversary-copy {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.button.small {
  justify-self: start;
  min-height: 38px;
  padding: 6px 12px;
  font-size: var(--font-xs);
}
.anniversary-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
