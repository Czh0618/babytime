export type BrowserSpeechError =
  | "not-allowed"
  | "service-not-allowed"
  | "no-speech"
  | "network"
  | "audio-capture"
  | "aborted"
  | "language-not-supported"
  | "unknown";

export interface BrowserSpeechCallbacks {
  onText: (text: string, isFinal: boolean) => void;
  onState: (state: "listening" | "stopped") => void;
  onError: (error: BrowserSpeechError) => void;
}

interface SpeechAlternativeLike {
  transcript: string;
}

interface SpeechResultLike {
  isFinal: boolean;
  [index: number]: SpeechAlternativeLike;
}

interface SpeechResultEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResultLike };
}

interface SpeechErrorEventLike extends Event {
  error?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

export type BrowserSpeechAvailability =
  | "available"
  | "needs-https"
  | "unsupported";

interface SpeechRuntime {
  isSecureContext?: boolean;
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getConstructor(
  runtime = window as unknown as SpeechRuntime,
): SpeechRecognitionConstructor | undefined {
  return runtime.SpeechRecognition ?? runtime.webkitSpeechRecognition;
}

// 录音只在 HTTPS（或 localhost）可用：iPhone 的 Safari/Chrome 在 http 页面
// 直接移除识别和麦克风接口，不弹权限提示；桌面 Chrome 保留接口但会拒绝麦克风。
export function getBrowserSpeechAvailability(
  runtime = window as unknown as SpeechRuntime,
): BrowserSpeechAvailability {
  if (runtime.isSecureContext === false) return "needs-https";
  return getConstructor(runtime) ? "available" : "unsupported";
}

export function createBrowserSpeech(
  callbacks: BrowserSpeechCallbacks,
  injectedConstructor?: SpeechRecognitionConstructor,
) {
  const Constructor = injectedConstructor ?? getConstructor();
  if (!Constructor) return undefined;

  const recognition = new Constructor();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let active = false;
  let acceptResults = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimer = () => {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = undefined;
  };

  recognition.onstart = () => {
    if (!active) return;
    callbacks.onState("listening");
  };

  recognition.onresult = (event) => {
    if (!acceptResults) return;
    let finalText = "";
    let interimText = "";
    for (
      let index = event.resultIndex;
      index < event.results.length;
      index += 1
    ) {
      const result = event.results[index];
      const text = result?.[0]?.transcript ?? "";
      if (result?.isFinal) finalText += text;
      else interimText += text;
    }
    const text = finalText || interimText;
    if (text) callbacks.onText(text, Boolean(finalText));
  };

  recognition.onerror = (event) => {
    const error = (event.error ?? "unknown") as BrowserSpeechError;
    // Any service error ends this generation. Otherwise `onend` could restart
    // forever after a network/permission failure and keep prompting the user.
    active = false;
    acceptResults = false;
    stopTimer();
    if (error !== "aborted") callbacks.onError(error);
  };

  recognition.onend = () => {
    if (!active) {
      acceptResults = false;
      callbacks.onState("stopped");
      return;
    }
    // Mobile Chromium may end a continuous session after a short pause. Restart
    // the same generation without creating a second recognizer or losing text.
    stopTimer();
    restartTimer = setTimeout(() => {
      if (!active) return;
      try {
        recognition.start();
      } catch {
        /* an already-started service will emit its own events */
      }
    }, 120);
  };

  return {
    start() {
      active = true;
      acceptResults = true;
      stopTimer();
      try {
        recognition.start();
      } catch (error) {
        active = false;
        acceptResults = false;
        callbacks.onError(
          error instanceof DOMException &&
            ["NotAllowedError", "SecurityError"].includes(error.name)
            ? "not-allowed"
            : "unknown",
        );
        callbacks.onState("stopped");
      }
    },
    stop() {
      active = false;
      stopTimer();
      try {
        recognition.stop();
      } catch {
        callbacks.onState("stopped");
      }
    },
    abort() {
      active = false;
      acceptResults = false;
      stopTimer();
      try {
        recognition.abort();
      } catch {
        /* recognition can already be closed */
      }
      callbacks.onState("stopped");
    },
    destroy() {
      active = false;
      acceptResults = false;
      stopTimer();
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch {
        /* already closed */
      }
    },
  };
}
