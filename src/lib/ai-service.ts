import { ref } from "vue";

/**
 * AI 服务层：可插拔的 OpenAI 兼容 Chat Completions 通道。
 *
 * 设计边界：
 * - 配置只存本机 localStorage，不进 workspace，因此不会出现在备份 JSON 里。
 * - 只发送文字（原话 / 素材元信息），从不读取或上传照片、视频原片。
 * - 未配置、被关闭、网络失败时都有明确的错误码，界面据此回退本机整理。
 * - 浏览器直连第三方模型服务可能受 CORS 限制，错误文案需要把这一点讲清楚。
 */

const STORAGE_KEY = "babytime.aiService";
const REQUEST_TIMEOUT_MS = 30_000;

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface AIStatus {
  configured: boolean;
  enabled: boolean;
  model: string;
  baseUrl: string;
}

export type AIErrorCode =
  | "not-configured"
  | "disabled"
  | "invalid-config"
  | "network"
  | "auth"
  | "rate-limit"
  | "server"
  | "bad-response"
  | "aborted";

export class AIServiceError extends Error {
  readonly code: AIErrorCode;
  constructor(code: AIErrorCode, message: string) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/chat\/completions$/i, "");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readAIConfig(): AIConfig | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const baseUrl = stringField(parsed.baseUrl);
    const apiKey = stringField(parsed.apiKey);
    const model = stringField(parsed.model);
    if (!baseUrl || !apiKey || !model) return null;
    return {
      baseUrl,
      apiKey,
      model,
      enabled: parsed.enabled !== false,
    };
  } catch {
    return null;
  }
}

export function describeAIConfig(config: AIConfig): string | null {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return "请填写模型服务地址。";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "模型服务地址不是有效的网址。";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return "模型服务地址需要使用 http 或 https。";
  if (url.username || url.password)
    return "请不要在地址里填写账号或密码。";
  if (!config.apiKey.trim()) return "请填写 API 密钥。";
  if (!config.model.trim()) return "请填写模型名称。";
  return null;
}

export function saveAIConfig(input: AIConfig): void {
  const config: AIConfig = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey.trim(),
    model: input.model.trim(),
    enabled: input.enabled !== false,
  };
  const error = describeAIConfig(config);
  if (error) throw new AIServiceError("invalid-config", error);
  storage()?.setItem(STORAGE_KEY, JSON.stringify(config));
  refreshAIStatus();
}

export function setAIEnabled(enabled: boolean): void {
  const config = readAIConfig();
  if (!config) return;
  saveAIConfig({ ...config, enabled });
}

export function clearAIConfig(): void {
  storage()?.removeItem(STORAGE_KEY);
  refreshAIStatus();
}

export const aiStatus = ref<AIStatus>({
  configured: false,
  enabled: false,
  model: "",
  baseUrl: "",
});

export function refreshAIStatus(): AIStatus {
  const config = readAIConfig();
  const next: AIStatus = config
    ? {
        configured: true,
        enabled: config.enabled,
        model: config.model,
        baseUrl: config.baseUrl,
      }
    : { configured: false, enabled: false, model: "", baseUrl: "" };
  aiStatus.value = next;
  return next;
}

refreshAIStatus();

/** 界面统一用它判断能不能点 AI 按钮。 */
export function aiAvailable(): boolean {
  return aiStatus.value.configured && aiStatus.value.enabled;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/** 一次单轮文本对话；system 永远是第一条消息。 */
export async function aiChat(
  system: string,
  user: string,
  signal?: AbortSignal,
  /** 供「测试连接」使用：临时配置不落盘，也不受暂停开关影响。 */
  override?: AIConfig,
): Promise<string> {
  const config = override ?? readAIConfig();
  if (!config) throw new AIServiceError("not-configured", "还没有配置 AI 服务。");
  if (!override && !config.enabled)
    throw new AIServiceError("disabled", "AI 服务已暂停。");
  const error = describeAIConfig(config);
  if (error) throw new AIServiceError("invalid-config", error);
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } catch {
    if (signal?.aborted)
      throw new AIServiceError("aborted", "已取消这次 AI 整理。");
    if (timedOut)
      throw new AIServiceError("network", "AI 服务响应超时，请稍后再试。");
    throw new AIServiceError(
      "network",
      "连不上 AI 服务。请检查服务地址，以及浏览器是否允许跨域访问这个地址。",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new AIServiceError("auth", "API 密钥无效，或服务拒绝了这次请求。");
    if (response.status === 429)
      throw new AIServiceError("rate-limit", "调用太频繁或额度不足，请稍后再试。");
    if (response.status >= 500)
      throw new AIServiceError("server", "模型服务暂时不可用，请稍后再试。");
    throw new AIServiceError(
      "bad-response",
      `模型服务返回了 ${response.status}，请检查地址和模型名称。`,
    );
  }

  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new AIServiceError("bad-response", "模型服务返回的内容不是 JSON。");
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new AIServiceError("bad-response", "模型没有返回文字内容，请重试。");
  return content;
}

/** 把任意异常转成给用户看的一句话，不外泄密钥或后端细节。 */
export function aiErrorMessage(error: unknown): string {
  if (error instanceof AIServiceError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "这次 AI 整理没能完成，请重试或改用本机整理。";
}
