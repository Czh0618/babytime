import { activeProfileOf, legacyWorkspaceOf } from "../domain/profiles.ts";
import type { Recap, Workspace } from "../types";
import { readMedia } from "./storage";
import { blobToDataUrl } from "./media";
import { formatDate } from "../domain/date";
import { describeCare } from "../domain/care-records";
import { createBackup } from "./backup";

const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const fileName = (value: string) =>
  value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").slice(0, 60) || "宝宝时光";

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportRecords(workspace: Workspace): Promise<number> {
  const backup = await createBackup(workspace);
  const text = JSON.stringify(backup);
  downloadBlob(
    new Blob([text], { type: "application/json;charset=utf-8" }),
    `${fileName(activeProfileOf(workspace).name)}-成长备份.json`,
  );
  return backup.workspace.media.filter((item) => !item.demo).length - backup.mediaFiles.length;
}

/** 回滚用：只导出当前宝宝的旧格式备份，旧版前端可以直接恢复。 */
export async function exportLegacyRecords(workspace: Workspace): Promise<{ name: string; missing: number }> {
  const legacy = legacyWorkspaceOf(workspace);
  const backup = await createBackup(legacy);
  const name = `${fileName(activeProfileOf(workspace).name)}-成长备份-旧格式.json`;
  downloadBlob(
    new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" }),
    name,
  );
  return {
    name,
    missing: backup.workspace.media.filter((item) => !item.demo).length - backup.mediaFiles.length,
  };
}

export async function exportRecap(recap: Recap, workspace: Workspace) {
  const sections: string[] = [];
  for (const id of recap.entryIds) {
    const entry = workspace.entries.find((item) => item.id === id);
    if (!entry) continue;
    const media = workspace.media.find((item) => item.id === entry.mediaId);
    let image = "";
    if (media && !media.demo) {
      const data = await readMedia(media.id);
      if (data?.thumbnail)
        image = `<img src="${html(await blobToDataUrl(data.thumbnail))}" alt="${html(entry.title)}">`;
    }
    const note = [entry.care ? describeCare(entry.care) : "", entry.note]
      .filter(Boolean)
      .join("\n");
    sections.push(
      `<article>${image}<p class="date">${html(formatDate(entry.capturedAt))} · ${html(entry.tag)}</p><h2>${html(entry.title)}</h2><p class="note">${html(note)}</p>${media?.kind === "video" ? '<p class="hint">视频以静帧收录，完整原片保留在本机。</p>' : ""}${media?.demo ? '<p class="hint">示例记录，无真实宝宝影像。</p>' : ""}</article>`,
    );
  }
  const document = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${html(recap.title)} · 宝宝时光</title><style>*{box-sizing:border-box}body{margin:0;background:#faf7f2;color:#302d28;font:16px/1.8 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}main{max-width:680px;margin:auto;padding:48px 24px}header{padding:16px 0 32px;border-bottom:1px solid #e6ded3}small,.date,.hint{color:#756d62;font-size:12px;letter-spacing:.3px}h1{font:400 36px/1.5 Georgia,'Songti SC',serif;margin:20px 0 12px}h2{font-size:22px;font-weight:500}article{padding:30px 0;border-bottom:1px solid #e6ded3}img{width:100%;max-height:600px;object-fit:contain;border-radius:16px;background:#eee8de}.note{white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:40px;font-size:12px;color:#756d62}@media print{body{background:white}article{break-inside:avoid}main{padding:0}}</style></head><body><main><header><small>BABYTIME · 宝宝时光</small><h1>${html(recap.title)}</h1><p>${html(activeProfileOf(workspace).name)}的成长手记</p><p class="date">${html(formatDate(recap.dateFrom))} — ${html(formatDate(recap.dateTo))}</p></header>${sections.join("")}<footer>为平常日子，留一点位置。<br>本文件为图文回顾，未包含原始照片和视频文件。</footer></main></body></html>`;
  downloadBlob(
    new Blob([document], { type: "text/html;charset=utf-8" }),
    `${fileName(recap.title)}.html`,
  );
}
