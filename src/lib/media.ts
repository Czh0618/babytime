export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 120;

export interface PreparedMedia {
  file: File;
  kind: "image" | "video";
  duration?: number;
  thumbnail?: Blob;
  previewable: boolean;
}

export async function prepareMediaFile(file: File): Promise<PreparedMedia> {
  return { file, ...(await inspectMedia(file)) };
}

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "ogv",
  "avi",
  "mkv",
]);
const DECODE_TIMEOUT_MS = 8_000;

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function kindForFile(file: File): "image" | "video" | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const extension = extensionOf(file.name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return undefined;
}

export function validateMediaFile(file: File): void {
  if (!(file instanceof File)) throw new Error("请选择照片或视频文件。");
  if (file.size === 0) throw new Error("这个文件是空的，请重新选择。");
  if (file.size > MAX_FILE_BYTES) throw new Error("单个素材不能超过 100 MB。");
  if (!kindForFile(file)) throw new Error("只支持照片或视频格式。");
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(new Error("照片解码超时"));
    }, DECODE_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("照片格式暂不支持预览"));
    };
    image.src = url;
  });
}

function createImageBitmapWithTimeout(file: File): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("照片解码超时"));
    }, DECODE_TIMEOUT_MS);

    createImageBitmap(file)
      .then((bitmap) => {
        if (settled) {
          // The timeout may have already returned control to the fallback decoder.
          bitmap.close();
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(bitmap);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function imageThumbnail(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    // createImageBitmap accepts the Blob directly; the URL fallback handles older browsers.
    let source: ImageBitmap | HTMLImageElement;
    if (typeof createImageBitmap === "function") {
      try {
        source = await createImageBitmapWithTimeout(file);
      } catch {
        // HEIC and older browser decoders can reject ImageBitmap; try the DOM decoder once.
        source = await loadImageElement(url);
      }
    } else {
      source = await loadImageElement(url);
    }
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height =
      "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!width || !height) throw new Error("照片尺寸无效");
    const scale = Math.min(1, 960 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法生成照片预览");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if ("close" in source) source.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("照片预览生成失败")),
        "image/jpeg",
        0.86,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function videoInfo(
  file: File,
): Promise<{ duration?: number; thumbnail?: Blob; previewable: boolean }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    let metadataLoaded = false;
    let duration: number | undefined;
    const finish = (result: {
      duration?: number;
      thumbnail?: Blob;
      previewable: boolean;
    }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timer = window.setTimeout(() => {
      // Unsupported codecs should remain importable; they simply cannot be previewed here.
      finish({ duration, previewable: false });
    }, DECODE_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const onError = () => finish({ duration, previewable: false });
    const onMetadata = () => {
      metadataLoaded = true;
      if (Number.isFinite(video.duration)) {
        duration = video.duration;
        if (duration > MAX_VIDEO_SECONDS) {
          fail(new Error("视频不能超过 2 分钟。"));
          return;
        }
      }
      video.currentTime = duration ? Math.min(1, duration / 2) : 0;
    };
    const onData = () => {
      if (!metadataLoaded) return;
      if (duration === 0) {
        finish({ duration, previewable: true });
        return;
      }
      try {
        video.currentTime = duration ? Math.min(1, duration / 2) : 0;
      } catch {
        finish({ duration, previewable: false });
      }
    };
    const onSeeked = () => {
      const canvas = document.createElement("canvas");
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) {
        finish({ duration, previewable: false });
        return;
      }
      const scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        finish({ duration, previewable: false });
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) =>
          finish({
            duration,
            thumbnail: blob ?? undefined,
            previewable: Boolean(blob),
          }),
        "image/jpeg",
        0.84,
      );
    };
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("loadeddata", onData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.src = url;
    video.load();
  });
}

export async function inspectMedia(file: File): Promise<{
  kind: "image" | "video";
  duration?: number;
  thumbnail?: Blob;
  previewable: boolean;
}> {
  validateMediaFile(file);
  const kind = kindForFile(file) as "image" | "video";
  if (kind === "video") return { kind, ...(await videoInfo(file)) };
  try {
    return { kind, thumbnail: await imageThumbnail(file), previewable: true };
  } catch {
    // Keep the original file importable for formats such as HEIC that this browser cannot decode.
    return { kind, previewable: false };
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取本地预览失败，请重试。"));
    reader.onabort = () => reject(new Error("读取本地预览已取消。"));
    reader.readAsDataURL(blob);
  });
}
