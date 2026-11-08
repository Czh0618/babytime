<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { RefreshCw, ShieldCheck, Trash2 } from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";
import {
  clearSyncConfig,
  readSyncConfig,
  saveSyncConfig,
  syncUnavailableReason,
  syncState,
} from "../lib/sync-service";

const emit = defineEmits<{ close: []; saved: [] }>();

const form = reactive({ key: "", enabled: true });
const message = ref("");
const unavailable = syncUnavailableReason();

onMounted(() => {
  const saved = readSyncConfig();
  if (saved) Object.assign(form, saved);
});

function save() {
  try {
    saveSyncConfig({ ...form });
    emit("saved");
    emit("close");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "没能保存同步设置。";
  }
}

function remove() {
  clearSyncConfig();
  Object.assign(form, { key: "", enabled: true });
  message.value = "已清除本机的家庭密钥，同步已关闭；本机记录和服务器上的数据都没有动。";
}
</script>

<template>
  <ModalDialog title="多设备同步" subtitle="FAMILY SYNC" @close="emit('close')">
    <p class="modal-lead">
      填入部署时打印的家庭密钥，这台设备就会和家人的设备同步成长记录。同步失败不影响本机使用，联网后会自动重试。
    </p>
    <p v-if="unavailable" class="sync-message error" role="status">{{ unavailable }}</p>

    <form class="sync-form" @submit.prevent="save">
      <label class="field"
        ><span>家庭密钥 <small>只存本机 · 不进备份 JSON</small></span
        ><input
          v-model="form.key"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="64 位十六进制字符"
      /></label>
      <label class="check-field"
        ><input v-model="form.enabled" type="checkbox" />开启同步</label
      >
      <div class="sync-privacy">
        <ShieldCheck :size="18" aria-hidden="true" />
        <div>
          <p>
            同步的是结构化记录：成长记录、接种、回顾、宝宝资料、疫苗计划、里程碑，以及照片视频的文件名、类型和拍摄时间。它们会存到你自己的服务器上。
          </p>
          <p>
            照片原片与缩略图会存到你自己的服务器，别的设备先显示缩略图、点开时再取原片；视频仍然只留在拍摄它的设备上，不会上传。同步未开启或离线时，一切照旧只存本机。
          </p>
          <p>
            <strong>开启后，这台设备上已有的照片也会补传到服务器</strong>（包括升级前导入的），第一次会一张一张慢慢传；视频始终不动。如果你不想让某些旧照片离开本机，请先在本机删掉它们或先不要开启同步。
          </p>
          <p>
            两台设备改了同一条记录时，以后同步上去的为准；删除总是生效，不会被另一台设备复活。
          </p>
        </div>
      </div>
      <p v-if="message" class="sync-message" role="status">{{ message }}</p>
      <div class="sync-actions">
        <button class="button button-primary" type="submit" :disabled="!!unavailable">
          <RefreshCw :size="15" />保存并同步
        </button>
        <button
          v-if="syncState.configured"
          class="button button-ghost"
          type="button"
          @click="remove"
        >
          <Trash2 :size="15" />清除密钥
        </button>
      </div>
    </form>
  </ModalDialog>
</template>

<style scoped>
.sync-form {
  display: grid;
  gap: 15px;
  margin-top: 20px;
}
.sync-privacy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 14px;
  border-radius: 13px;
  background: var(--sage);
  color: var(--sage-ink);
}
.sync-privacy > svg {
  flex: none;
  margin-top: 2px;
}
.sync-privacy p {
  font-size: 12px;
  line-height: 1.75;
}
.sync-privacy p + p {
  margin-top: 6px;
}
.sync-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--tint);
  color: var(--accent);
  font-size: 13px;
  line-height: 1.6;
}
.sync-message.error {
  margin-top: 14px;
  background: var(--danger-bg);
  color: var(--danger-ink);
}
.sync-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
@media (max-width: 430px) {
  .sync-actions .button {
    flex: 1 1 100%;
  }
}
</style>
