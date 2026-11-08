<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  CloudUpload,
  Download,
  HardDrive,
  LockKeyhole,
  Moon,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
} from "@lucide/vue";
import { dayAge, localDate } from "../domain/date";
import { validateProfile } from "../domain/profile";
import { aiStatus } from "../lib/ai-service";
import { syncState } from "../lib/sync-service";
import { mediaSyncState } from "../lib/media-sync";
import { describePersistence, persistenceStatus } from "../lib/persistence";
import { isIOS, isStandalone, migrationCopy } from "../domain/pwa";
import type { ThemePreference } from "../domain/night";
import { setThemePreference, themePreference } from "../lib/theme";
import type { BabyProfile, FamilyStats } from "../types";

const props = withDefaults(
  defineProps<{
    baby: BabyProfile;
    profiles: BabyProfile[];
    stats: FamilyStats;
    hasDemo: boolean;
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  save: [baby: BabyProfile];
  addProfile: [baby: BabyProfile];
  removeProfile: [id: string];
  clearDemo: [];
  exportData: [];
  exportLegacy: [];
  restoreData: [file: File];
  clearData: [];
  openAiSettings: [];
  openSyncSettings: [];
  syncNow: [];
}>();

const draft = reactive<BabyProfile & { sex?: "male" | "female" | ""; dueDate?: string }>(
  { ...props.baby },
);
/** 正在填写一个新宝宝档案；保存后切换到它。 */
const creating = ref(false);
const notice = reactive({ text: "", kind: "success" as "success" | "error" });
const today = localDate();
const migration = migrationCopy({
  standalone: isStandalone(),
  ios: isIOS(typeof navigator === "undefined" ? "" : navigator.userAgent),
});

watch(
  () => props.baby,
  (value) => {
    if (!creating.value) Object.assign(draft, value);
  },
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

const syncLabel = computed(() =>
  !syncState.value.configured ? "未开启" : syncState.value.enabled ? "已开启" : "已暂停",
);
const syncDescription = computed(() => {
  const state = syncState.value;
  if (!state.configured)
    return "默认只存在这台设备。开启后，成长记录会存到你自己的服务器，照片与缩略图也会存到服务器，视频只存本机；家人的设备可以一起看、一起记。";
  if (state.running) return "正在同步…";
  if (state.error) return state.error;
  if (!state.enabled) return "已暂停，本机记录照常保存，服务器上的数据保留。";
  return state.lastAt
    ? `上次同步：${new Date(state.lastAt).toLocaleString()}。照片和缩略图存到你自己的服务器，视频只存本机；本机已有的原片永远优先。`
    : "已开启。照片和缩略图会存到你自己的服务器，视频只存本机。";
});
const mediaPending = computed(() => mediaSyncState.value.pending.length);

function changeTheme(event: Event) {
  setThemePreference(
    (event.target as HTMLSelectElement).value as ThemePreference,
  );
}

function saveProfile() {
  notice.text = "";
  const profile = {
    ...draft,
    name: draft.name.trim(),
    sex: draft.sex || undefined,
    dueDate: draft.dueDate || undefined,
  };
  const error = validateProfile(profile, today);
  if (error) {
    notice.kind = "error";
    notice.text = error;
    return;
  }
  notice.kind = "success";
  if (creating.value) {
    emit("addProfile", profile);
    creating.value = false;
    return;
  }
  emit("save", profile);
}

function startCreate() {
  creating.value = true;
  notice.text = "";
  Object.assign(draft, {
    name: "", birthDate: "", sex: "" as const, dueDate: "",
  });
}

function cancelCreate() {
  creating.value = false;
  notice.text = "";
  Object.assign(draft, props.baby);
}

function removeProfile() {
  emit("removeProfile", props.baby.id ?? "");
}

function exportData() {
  emit("exportData");
}

function exportLegacy() {
  emit("exportLegacy");
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
          <h2 class="section-heading">
            {{ creating ? "添加宝宝" : baby.name || "宝宝资料" }}
          </h2>
          <p class="muted">
            {{ creating ? "新宝宝从空白档案开始" : ageLabel }} · 本机共
            {{ profiles.length }} 个宝宝档案
          </p>
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
        <label class="field"
          ><span>性别 <small>可选 · 用于生长曲线</small></span
          ><select
            class="input"
            :value="draft.sex ?? ''"
            @change="
              draft.sex = (($event.target as HTMLSelectElement).value ||
                undefined) as 'male' | 'female' | undefined
            "
          >
            <option value="">暂不填写</option>
            <option value="male">男孩</option>
            <option value="female">女孩</option>
          </select></label
        >
        <label class="field"
          ><span>预产期 <small>可选 · 早产时用于矫正月龄</small></span
          ><input v-model="draft.dueDate" class="input" type="date"
        /></label>
      </div>
      <div class="profile-actions">
        <button
          class="button button-primary"
          type="submit"
          :disabled="!valid || busy"
        >
          <Save :size="17" aria-hidden="true" />{{ creating ? "保存并切到这个宝宝" : "保存资料" }}
        </button>
        <button
          v-if="creating"
          class="button button-ghost"
          type="button"
          :disabled="busy"
          @click="cancelCreate"
        >
          取消添加
        </button>
        <button
          v-else
          class="button button-secondary"
          type="button"
          :disabled="busy"
          @click="startCreate"
        >
          <UserRound :size="17" aria-hidden="true" />添加宝宝
        </button>
        <button
          v-if="!creating && profiles.length > 1"
          class="button button-secondary danger"
          type="button"
          :disabled="busy"
          @click="removeProfile"
        >
          <Trash2 :size="16" aria-hidden="true" />删除这个宝宝
        </button>
      </div>
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
              没开启同步时，记录、照片和视频都只留在本机浏览器；开启后也只有你自己服务器会收到记录与照片。
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
            <ul class="ai-scope">
              <li><span>语音整理</span>只发你口述或输入的文字，不发录音。</li>
              <li>
                <span>待整理起名</span>只发文件名、类型、拍摄时间和那句话，看不到画面。
              </li>
              <li><span>趋势解读</span>只发按天汇总的数字与月龄，不发原话。</li>
              <li>宝宝姓名、生日和照片视频始终不发；结果一律先给你确认。</li>
            </ul>
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
        <div class="setting-row ai-setting-row">
          <CloudUpload :size="20" aria-hidden="true" />
          <div>
            <strong>多设备同步</strong>
            <p class="muted">{{ syncDescription }}</p>
            <p v-if="syncState.configured && syncState.enabled" class="muted media-sync-line">
              <template v-if="mediaPending">
                待上传照片 {{ mediaPending }} 张（含升级前导入的），会一张一张传，失败下次同步自动重试。
              </template>
              <template v-else-if="mediaSyncState.error">{{ mediaSyncState.error }}</template>
              <template v-else>照片已全部传到你自己的服务器；视频仍只留在本机。</template>
              <template v-if="mediaSyncState.oversized">
                另有 {{ mediaSyncState.oversized }} 张超过 20 MB，服务器不接收，只留在本机。
              </template>
            </p>
          </div>
          <div class="ai-setting-actions">
            <span class="pill">{{ syncLabel }}</span>
            <button
              v-if="syncState.enabled"
              class="button button-secondary"
              type="button"
              :disabled="busy || syncState.running"
              @click="emit('syncNow')"
            >
              <RefreshCw :size="15" />立即同步
            </button>
            <button
              class="button button-secondary"
              type="button"
              :disabled="busy"
              @click="emit('openSyncSettings')"
            >
              <Settings2 :size="15" />设置
            </button>
          </div>
        </div>
        <div class="setting-row">
          <Moon :size="20" aria-hidden="true" />
          <div>
            <strong>外观</strong>
            <p class="muted">
              浅色 / 深色，或跟随系统。夜间会自动降低今天页的亮度。
            </p>
          </div>
          <select
            class="theme-select"
            :value="themePreference"
            aria-label="外观主题"
            @change="changeTheme"
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
        <div class="setting-row">
          <LockKeyhole :size="20" aria-hidden="true" />
          <div>
            <strong>谁能看到记录</strong>
            <p class="muted">
              {{
                syncState.enabled
                  ? "这台设备和填了同一家庭密钥的设备，以及能登录你服务器的人。成长记录、照片与缩略图存在你自己的服务器，视频只存本机；没有邀请或公开分享功能。"
                  : "只有这台设备。开启多设备同步后，成长记录、照片与缩略图会存到你自己的服务器，视频仍只存本机。没有邀请或公开分享功能。"
              }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="migration-card" aria-labelledby="migration-heading">
      <div class="migration-icon">
        <Smartphone :size="20" aria-hidden="true" />
      </div>
      <div>
        <p class="eyebrow">KEEP YOUR RECORDS</p>
        <h2 id="migration-heading" class="section-heading">
          {{ migration.title }}
        </h2>
        <ol class="migration-steps">
          <li v-for="(step, index) in migration.steps" :key="index">
            {{ step }}
          </li>
        </ol>
        <p class="muted">{{ migration.note }}</p>
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
              包含全部宝宝资料、成长记录、回顾，以及本机可用的原始照片与视频。文件较大时请耐心等待。
            </p>
          </div>
          <div class="data-action-buttons">
            <button
              class="button button-secondary"
              type="button"
              :disabled="busy"
              @click="exportData"
            >
              <Download :size="16" aria-hidden="true" />导出
            </button>
            <button
              class="button button-ghost"
              type="button"
              :disabled="busy"
              @click="exportLegacy"
            >
              导出当前宝宝的旧格式
            </button>
          </div>
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
  background: var(--danger-bg);
  color: var(--danger-ink);
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
.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.data-action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
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
.migration-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-top: 22px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--tint);
}
.migration-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 14px;
  background: var(--surface);
  color: var(--accent);
}
.migration-steps {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.7;
}
.media-sync-line {
  margin-top: 6px;
  font-size: var(--font-xs);
  line-height: 1.7;
}
.migration-card .muted {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
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
.ai-scope {
  display: grid;
  gap: 3px;
  margin: 8px 0 0;
  padding-left: 16px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}
.ai-scope span {
  color: var(--ink);
  font-weight: 500;
}
.theme-select {
  flex: none;
  max-width: 130px;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--bg);
  color: var(--ink);
  font-size: 13px;
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
  color: var(--danger);
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
  .migration-card {
    gap: 10px;
    padding: 15px;
  }
  .migration-icon {
    width: 40px;
    height: 40px;
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
