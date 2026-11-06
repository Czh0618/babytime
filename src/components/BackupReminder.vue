<script setup lang="ts">
import { Download, X } from "@lucide/vue";

const emit = defineEmits<{ export: []; dismiss: [] }>();
</script>

<template>
  <div class="backup-reminder" role="status">
    <div class="backup-reminder-copy">
      <strong>该备份一次了</strong>
      <p>本机记录超过 7 天没有导出备份。导出一份 JSON，换设备或清理浏览器数据也不怕丢。</p>
    </div>
    <div class="backup-reminder-actions">
      <button
        class="button button-primary"
        type="button"
        @click="emit('export')"
      >
        <Download :size="16" aria-hidden="true" />立即导出
      </button>
      <button
        class="icon-button"
        type="button"
        aria-label="暂时不提醒"
        @click="emit('dismiss')"
      >
        <X :size="18" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.backup-reminder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--sage);
  color: var(--sage-ink);
}
.backup-reminder-copy {
  flex: 1;
  min-width: 200px;
}
.backup-reminder-copy strong {
  font-size: 14px;
  font-weight: 600;
}
.backup-reminder-copy p {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.65;
}
.backup-reminder-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
@media (max-width: 430px) {
  .backup-reminder-actions {
    width: 100%;
  }
  .backup-reminder-actions .button {
    flex: 1;
  }
}
</style>
