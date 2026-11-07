<script setup lang="ts">
import { ArrowUpRight, Mic } from "@lucide/vue";
defineEmits<{ start: [] }>();
</script>

<template>
  <section class="voice-entry-card" aria-labelledby="voice-entry-heading">
    <div class="voice-entry-copy">
      <p class="eyebrow">SAY A LITTLE, KEEP A LITTLE</p>
        <h2 id="voice-entry-heading"><span>说一句，</span><span>记下今天。</span></h2>
      <p>
        喂奶、睡眠、换尿布，<br class="mobile-break" />那些来不及打字的小事。
      </p>
      <button class="voice-entry-example" type="button" @click="$emit('start')">
        试着说：“刚刚喂奶九十毫升”
        <ArrowUpRight :size="14" aria-hidden="true" />
      </button>
    </div>
    <button
      class="voice-entry-start"
      type="button"
      aria-label="开始语音记录"
      @click="$emit('start')"
    >
      <Mic :size="29" :stroke-width="1.5" aria-hidden="true" /><span
        >语音记一下</span
      >
    </button>
  </section>
</template>

<style scoped>
.voice-entry-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 24px;
  border-radius: 22px;
  background: var(--tint);
  border: 1px solid var(--line);
}
.voice-entry-copy {
  min-width: 0;
}
.voice-entry-copy h2 {
  font:
    400 26px/1.5 Georgia,
    "Songti SC",
    serif;
  color: var(--ink);
  letter-spacing: 0.3px;
}
.voice-entry-copy h2 span { white-space: nowrap; }
.voice-entry-copy > p:not(.eyebrow) {
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted);
  margin-top: 7px;
}
.voice-entry-example {
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  font-size: var(--font-xs);
  line-height: 1.7;
  min-height: 44px;
  padding: 7px 0 0;
  background: none;
  border: 0;
  color: var(--accent);
}
.voice-entry-example svg {
  flex: none;
}
.voice-entry-start {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 10px;
  flex: none;
  width: 104px;
  min-height: 112px;
  padding: 16px 11px;
  border: 0;
  border-radius: 26px;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 9px 22px #60432f16;
}
.voice-entry-start span {
  font-size: var(--font-xs);
  white-space: nowrap;
}
.mobile-break {
  display: none;
}
@media (max-width: 440px) {
  .voice-entry-copy h2 span { display: block; }
  .voice-entry-card {
    padding: 19px 17px;
    gap: 12px;
  }
  .voice-entry-copy h2 {
    font-size: 23px;
  }
  .voice-entry-card .eyebrow {
    font-size: 8px;
    letter-spacing: 1px;
  }
  .voice-entry-start {
    width: 76px;
    min-height: 100px;
    border-radius: 23px;
    padding: 12px 8px;
  }
  .voice-entry-start svg {
    width: 26px;
  }
  .voice-entry-copy > p:not(.eyebrow) {
    font-size: var(--font-xs);
  }
  .mobile-break {
    display: initial;
  }
  .voice-entry-example {
    font-size: var(--font-xs);
  }
  .voice-entry-example svg {
    display: none;
  }
}
</style>
