<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Eye, EyeOff, PlugZap, ShieldCheck, Trash2 } from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";
import {
  aiChat,
  aiErrorMessage,
  aiStatus,
  clearAIConfig,
  readAIConfig,
  refreshAIStatus,
  saveAIConfig,
} from "../lib/ai-service";

const emit = defineEmits<{ close: []; saved: [] }>();

const form = reactive({
  baseUrl: "",
  apiKey: "",
  model: "",
  enabled: true,
});
const busy = ref(false);
/** 默认明文：iOS 的 password 字段会禁用第三方输入法，也无法复制粘贴复杂密钥。 */
const keyHidden = ref(false);
const message = ref("");
const messageKind = ref<"success" | "error">("success");
let controller: AbortController | undefined;

const TEST_SYSTEM_PROMPT =
  "你是连通性测试助手。无论用户说什么，都只回复两个字：可用。";
const TEST_USER_PROMPT = "测试连接";

onMounted(() => {
  refreshAIStatus();
  const saved = readAIConfig();
  if (saved) Object.assign(form, saved);
});

onBeforeUnmount(() => controller?.abort());

function say(text: string, kind: "success" | "error" = "success") {
  message.value = text;
  messageKind.value = kind;
}

function save() {
  try {
    saveAIConfig({ ...form });
    emit("saved");
    emit("close");
  } catch (error) {
    say(aiErrorMessage(error), "error");
  }
}

async function testConnection() {
  if (busy.value) return;
  busy.value = true;
  say("");
  controller = new AbortController();
  try {
    await aiChat(TEST_SYSTEM_PROMPT, TEST_USER_PROMPT, controller.signal, {
      ...form,
      enabled: true,
    });
    say("连接成功，模型已正常返回内容。还没有保存配置。");
  } catch (error) {
    say(aiErrorMessage(error), "error");
  } finally {
    controller = undefined;
    busy.value = false;
  }
}

function remove() {
  clearAIConfig();
  Object.assign(form, { baseUrl: "", apiKey: "", model: "", enabled: true });
  keyHidden.value = false;
  say("已清除本机配置，AI 辅助整理已关闭。");
}
</script>

<template>
  <ModalDialog
    title="AI 服务设置"
    subtitle="OPTIONAL AI ASSIST"
    :busy="busy"
    @close="emit('close')"
  >
    <p class="modal-lead">
      填一个兼容 OpenAI Chat Completions 的模型服务，BabyTime 就能帮你把口述整理成草稿、给素材起名字。不配置也完全可用，语音会走本机规则整理。
    </p>

    <form class="ai-form" @submit.prevent="save">
      <label class="field"
        ><span>服务地址 <small>到 /v1 即可，会自动补 /chat/completions</small></span
        ><input
          v-model="form.baseUrl"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="https://your-endpoint.example.com/v1"
      /></label>
      <label class="field"
        ><span>模型名称</span
        ><input
          v-model="form.model"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="例如 gpt-4o-mini"
      /></label>
      <div class="field">
        <span>API 密钥 <small>只存本机 · 默认明文便于粘贴</small></span>
        <div class="secret-input">
          <input
            v-model="form.apiKey"
            :type="keyHidden ? 'password' : 'text'"
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            aria-label="API 密钥"
            placeholder="sk-…"
          />
          <button
            class="secret-toggle"
            type="button"
            :aria-label="keyHidden ? '显示密钥' : '隐藏密钥'"
            :aria-pressed="keyHidden"
            @click="keyHidden = !keyHidden"
          >
            <Eye v-if="keyHidden" :size="18" aria-hidden="true" />
            <EyeOff v-else :size="18" aria-hidden="true" />
          </button>
        </div>
      </div>
      <label class="check-field"
        ><input v-model="form.enabled" type="checkbox" />启用 AI 辅助整理</label
      >
      <div class="ai-privacy">
        <ShieldCheck :size="18" aria-hidden="true" />
        <div>
          <p>
            密钥只写进当前浏览器的本机存储，不会进入工作区或备份 JSON，也不会上传到 BabyTime。
          </p>
          <p>
            输入框默认明文，方便在手机上切换输入法、用跨设备剪贴板粘贴复杂密钥；点右侧图标可临时隐藏。关闭 iOS 自动大写与自动改写，避免密钥被改错。
          </p>
          <p>
            AI 只接收你写下的文字，以及素材的文件名、类型和拍摄时间；照片与视频原片始终留在本机。
          </p>
          <p>
            浏览器会直连你填写的服务地址。若该服务不允许跨域（CORS），调用会失败，需要换用支持浏览器直连的服务或自建代理。
          </p>
        </div>
      </div>
      <p v-if="message" :class="['ai-message', { error: messageKind === 'error' }]" role="status">
        {{ message }}
      </p>
      <div class="ai-actions">
        <button class="button button-primary" type="submit" :disabled="busy">
          保存设置
        </button>
        <button
          class="button button-secondary"
          type="button"
          :disabled="busy"
          @click="testConnection"
        >
          <PlugZap :size="16" />{{ busy ? "正在测试…" : "测试连接" }}
        </button>
        <button
          v-if="aiStatus.configured"
          class="button button-ghost"
          type="button"
          :disabled="busy"
          @click="remove"
        >
          <Trash2 :size="15" />清除配置
        </button>
      </div>
    </form>
    <p class="fine-print left">
      测试连接会用你填的地址发起一次很小的模型调用，可能计入该服务的用量；测试不会保存配置。AI
      生成的全部内容都只是草稿，确认前请逐条核对。
    </p>
  </ModalDialog>
</template>

<style scoped>
.ai-form {
  display: grid;
  gap: 15px;
  margin-top: 20px;
}
.secret-input {
  position: relative;
}
.secret-input input {
  padding-right: 50px;
}
.secret-toggle {
  position: absolute;
  top: 50%;
  right: 3px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.secret-toggle:hover {
  background: var(--tint);
  color: var(--accent);
}
.ai-privacy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 14px;
  border-radius: 13px;
  background: var(--sage);
  color: var(--sage-ink);
}
.ai-privacy > svg {
  flex: none;
  margin-top: 2px;
}
.ai-privacy p {
  font-size: 12px;
  line-height: 1.75;
}
.ai-privacy p + p {
  margin-top: 6px;
}
.ai-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--tint);
  color: var(--accent);
  font-size: 13px;
  line-height: 1.6;
}
.ai-message.error {
  background: var(--danger-bg);
  color: var(--danger-ink);
}
.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.fine-print.left {
  text-align: left;
}
@media (max-width: 430px) {
  .ai-actions .button {
    flex: 1 1 100%;
  }
}
</style>
