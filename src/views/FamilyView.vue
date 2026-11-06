<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  Download,
  HardDrive,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "@lucide/vue";
import { dayAge, localDate } from "../domain/date";
import { aiStatus } from "../lib/ai-service";
import { describePersistence, persistenceStatus } from "../lib/persistence";
import type { BabyProfile, FamilyStats } from "../types";

const props = withDefaults(
  defineProps<{
    baby: BabyProfile;
    stats: FamilyStats;
    hasDemo: boolean;
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  save: [baby: BabyProfile];
  clearDemo: [];
  exportData: [];
  restoreData: [file: File];
  clearData: [];
  openAiSettings: [];
}>();

const draft = reactive<BabyProfile>({ ...props.baby });
const notice = reactive({ text: "", kind: "success" as "success" | "error" });
const today = localDate();

watch(
  () => props.baby,
  (value) => Object.assign(draft, value),
  { deep: true },
);
const ageLabel = computed(() =>
  draft.birthDate ? `${dayAge(draft.birthDate)} 天` : "还未填写生日",
);
const valid = computed(
  () =>
    draft.name.trim().length > 0 &&
    !!draft.birthDate &&
    draft.birthDate <= today,
);
const storageLabel = computed(() =>
  props.stats.bytes
    ? `${(props.stats.bytes / 1024 / 1024).toFixed(1)} MB`
    : "暂无原片",
);
const persistence = computed(() =>
  describePersistence(persistenceStatus.value),
);
const aiLabel = computed(() =>
  !aiStatus.value.configured
    ? "未配置"
    : aiStatus.value.enabled
      ? "已启用"
      : "已暂停",
);
const aiDescription = computed(() => {
  const status = aiStatus.value;
  if (!status.configured)
    return "语音整理目前使用本机规则。填入自己的模型服务即可开启 AI 辅助；照片和视频不会上传。";
  if (!status.enabled)
    return `已配置 ${status.model}，当前已暂停。语音整理会继续使用本机规则。`;
  return `已连接 ${status.model}。AI 只接收你写下的文字与素材元信息，原片仍只保存在本机；生成内容一律是待确认草稿。`;
});

function saveProfile() {
  notice.text = "";
  if (!draft.name.trim()) {
    notice.kind = "error";
    notice.text = "请先填写宝宝昵称。";
    return;
  }
  if (!draft.birthDate) {
    notice.kind = "error";
    notice.text = "请先填写宝宝生日。";
    return;
  }
  if (draft.birthDate > today) {
    notice.kind = "error";
    notice.text = "生日不能晚于今天。";
    return;
  }
  emit("save", { name: draft.name.trim(), birthDate: draft.birthDate });
}

function exportData() {
  emit("exportData");
}

function restoreData(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) emit("restoreData", file);
}

function clearDemo() {
  emit("clearDemo");
}

function clearData() {
  emit("clearData");
}
</script>

<template>
  <section class="page family-page" aria-labelledby="family-heading">
    <div class="page-heading-row">
      <div>
        <p class="eyebrow">OUR PRIVATE CORNER</p>
        <h1 id="family-heading" class="page-heading">一个家庭，一本时光</h1>
        <p class="muted page-lede">记录属于你们，如何保存也由你们决定。</p>
      </div>
    </div>
    <div
      v-if="notice.text"
      class="notice"
      :class="{ error: notice.kind === 'error' }"
      role="status"
    >
      <ShieldCheck :size="16" aria-hidden="true" />{{ notice.text }}
    </div>

    <form class="profile-card surface" @submit.prevent="saveProfile">
      <div class="card-heading">
        <div class="avatar"><UserRound :size="22" aria-hidden="true" /></div>
        <div>
          <p class="eyebrow">BABY PROFILE</p>
          <h2 class="section-heading">{{ baby.name || "宝宝资料" }}</h2>
          <p class="muted">{{ ageLabel }}</p>
        </div>
      </div>
      <div class="form-grid">
        <label class="field"
          ><span>宝宝昵称</span
          ><input
            v-model="draft.name"
            class="input"
            maxlength="30"
            placeholder="例如：小满"
            required /></label
        ><label class="field"
          ><span>出生日期</span
          ><input
            v-model="draft.birthDate"
            class="input"
            type="date"
            :max="today"
            required
        /></label>
      </div>
      <button
        class="button button-primary"
        type="submit"
        :disabled="!valid || busy"
      >
        <Save :size="17" aria-hidden="true" />保存资料
      </button>
    </form>

    <section class="stats-grid" aria-label="本机记录统计">
      <div class="stat surface">
        <span class="muted">记录素材</span><strong>{{ stats.media }}</strong
        ><small>张照片或段视频</small>
      </div>
      <div class="stat surface">
        <span class="muted">成长记录</span><strong>{{ stats.entries }}</strong
        ><small>条家长确认</small>
      </div>
      <div class="stat surface">
        <span class="muted">已保存回顾</span><strong>{{ stats.recaps }}</strong
        ><small>份图文回顾</small>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="privacy-heading">
      <div class="section-heading-row">
        <div>
          <p class="eyebrow">PRIVATE BY DEFAULT</p>
          <h2 id="privacy-heading" class="section-heading">数据与隐私</h2>
        </div>
      </div>
      <div class="settings-list surface">
        <div class="setting-row">
          <HardDrive :size="20" aria-hidden="true" />
          <div>
            <strong>只保存在这台设备</strong>
            <p class="muted">
              当前版本保存在本机浏览器中，不会自动上传到云端。
            </p>
          </div>
          <span class="pill">{{ storageLabel }}</span>
        </div>
        <div class="setting-row">
          <ShieldCheck :size="20" aria-hidden="true" />
          <div>
            <strong>本机存储保护</strong>
            <p class="muted">{{ persistence.copy }}</p>
          </div>
          <span class="pill">{{ persistence.label }}</span>
        </div>
        <div class="setting-row">
          <ShieldCheck :size="20" aria-hidden="true" />
          <div>
            <strong>语音识别</strong>
            <p class="muted">
              由浏览器自带服务识别，可能联网处理音频；BabyTime 不保存录音。
            </p>
          </div>
        </div>
        <div class="setting-row ai-setting-row">
          <Sparkles :size="20" aria-hidden="true" />
          <div>
            <strong>AI 辅助整理</strong>
            <p class="muted">{{ aiDescription }}</p>
          </div>
          <div class="ai-setting-actions">
            <span class="pill">{{ aiLabel }}</span>
            <button
              class="button button-secondary"
              type="button"
              :disabled="busy"
              @click="emit('openAiSettings')"
            >
              <Settings2 :size="15" />设置
            </button>
          </div>
        </div>
        <div class="setting-row">
          <LockKeyhole :size="20" aria-hidden="true" />
          <div>
            <strong>谁能看到记录</strong>
            <p class="muted">目前没有家庭云同步、邀请或公开分享功能。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="data-section" aria-labelledby="data-heading">
      <div class="section-heading-row">
        <div>
          <p class="eyebrow">TAKE CONTROL</p>
          <h2 id="data-heading" class="section-heading">带走或清理数据</h2>
        </div>
      </div>
      <div class="data-actions surface">
        <div class="data-action">
          <div>
            <strong>导出备份 JSON</strong>
            <p class="muted">
              包含宝宝资料、成长记录、回顾，以及本机可用的原始照片与视频。文件较大时请耐心等待。
            </p>
          </div>
          <button
            class="button button-secondary"
            type="button"
            :disabled="busy"
            @click="exportData"
          >
            <Download :size="16" aria-hidden="true" />导出
          </button>
        </div>
        <div class="data-action">
          <div>
            <strong>从备份恢复</strong>
            <p class="muted">
              恢复记录及备份内的原片。兼容旧版 JSON；旧备份缺少的照片或视频可在编辑记录时补回。
            </p>
          </div>
          <label class="button button-secondary">
            <RotateCcw :size="16" aria-hidden="true" />恢复
            <input
              class="visually-hidden"
              type="file"
              accept="application/json,.json"
              :disabled="busy"
              @change="restoreData"
            />
          </label>
        </div>
        <div v-if="hasDemo" class="data-action">
          <div>
            <strong>清除示例记录</strong>
            <p class="muted">
              只移除本次演示带来的示例内容，真实导入的素材会保留。
            </p>
          </div>
          <button
            class="button button-secondary"
            type="button"
            :disabled="busy"
            @click="clearDemo"
          >
            <RefreshCw :size="16" aria-hidden="true" />清除示例
          </button>
        </div>
        <div class="data-action destructive-row">
          <div>
            <strong>清空本机数据</strong>
            <p class="muted">
              会删除这台设备上的宝宝资料、素材、成长记录和回顾。操作前会再次确认。
            </p>
          </div>
          <button
            class="button button-secondary danger"
            type="button"
            :disabled="busy"
            @click="clearData"
          >
            <Trash2 :size="16" aria-hidden="true" />清空数据
          </button>
        </div>
      </div>
    </section>
    <p class="footnote">
      BabyTime
      只帮助保存家庭记忆，不替代照护者，也不用于判断宝宝健康或发育情况。
    </p>
  </section>
</template>

<style scoped>
.family-page {
  padding-bottom: 46px;
}
.page-heading-row,
.section-heading-row,
.card-heading,
.setting-row,
.data-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.page-heading-row {
  align-items: flex-start;
}
.page-lede {
  margin-top: 8px;
}
.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sage);
  color: var(--sage-ink);
  border-radius: 12px;
  padding: 12px 14px;
  margin: 18px 0;
}
.notice.error {
  background: #f7e5df;
  color: #8d3f31;
}
.surface {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(74, 52, 30, 0.045);
}
.profile-card {
  padding: 22px;
  margin-top: 24px;
}
.card-heading {
  justify-content: flex-start;
}
.avatar {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 17px;
  background: var(--tint);
  color: var(--accent);
  flex: none;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 24px 0 18px;
}
.field {
  display: grid;
  gap: 7px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}
.input {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--bg);
  color: var(--ink);
  padding: 10px 12px;
  font: inherit;
  font-size: 16px;
}
.input:focus {
  outline: 3px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-color: var(--accent);
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 18px 0 34px;
}
.stat {
  padding: 15px;
  display: grid;
  gap: 3px;
}
.stat strong {
  font:
    500 28px/1.2 Georgia,
    "Songti SC",
    serif;
}
.stat small {
  color: var(--muted);
  font-size: var(--font-xs);
}
.settings-section,
.data-section {
  margin-top: 30px;
}
.settings-list,
.data-actions {
  margin-top: 14px;
  padding: 0 18px;
}
.setting-row,
.data-action {
  justify-content: flex-start;
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.setting-row:last-child,
.data-action:last-child {
  border-bottom: 0;
}
.setting-row > svg {
  color: var(--accent);
  flex: none;
}
.setting-row > div,
.data-action > div {
  flex: 1;
  min-width: 0;
}
.setting-row strong,
.data-action strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
.setting-row p,
.data-action p {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
}
.setting-row .pill {
  flex: none;
}
.ai-setting-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.ai-setting-actions .button {
  min-height: 40px;
  padding: 8px 12px;
}
.data-action {
  align-items: center;
}
.destructive-row {
  border-bottom: 0;
}
.danger {
  color: #a14d3b;
}
.footnote {
  color: var(--muted);
  font-size: var(--font-xs);
  text-align: center;
  margin: 28px auto 0;
  max-width: 600px;
}
@media (max-width: 560px) {
  .page-heading-row {
    display: grid;
    gap: 12px;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .stats-grid {
    gap: 8px;
  }
  .stat {
    padding: 12px 10px;
  }
  .stat strong {
    font-size: 24px;
  }
  .setting-row,
  .data-action {
    align-items: flex-start;
  }
  .setting-row .pill {
    margin-left: auto;
  }
  .ai-setting-row {
    flex-wrap: wrap;
  }
  .ai-setting-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .data-action {
    flex-wrap: wrap;
  }
  .data-action > div {
    width: 100%;
  }
  .data-action .button {
    width: 100%;
  }
}
@media (max-width: 350px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .stats-grid .stat {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .stats-grid .stat small {
    margin-left: auto;
  }
}
</style>
