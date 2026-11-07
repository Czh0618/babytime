/**
 * 单剂疫苗的日历文件：一天的整日事件 + 提前 1 天提醒。
 * 只生成标准 .ics，iOS / Android 的日历都能导入。
 */

export interface VaccineEvent {
  code: string;
  name: string;
  dose: number;
  dueDate: string;
}

function compact(date: string): string {
  return date.slice(0, 10).replace(/-/g, "");
}

function nextDay(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const value = new Date(year!, month! - 1, day! + 1);
  const monthText = String(value.getMonth() + 1).padStart(2, "0");
  const dayText = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}${monthText}${dayText}`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function buildVaccineIcs(event: VaccineEvent, now = new Date()): string {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  const title = `接种 ${event.name} 第 ${event.dose} 剂`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BabyTime//Vaccine Reminder//CN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:babytime-${event.code}-${event.dose}-${compact(event.dueDate)}@local`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(event.dueDate)}`,
    `DTEND;VALUE=DATE:${nextDay(event.dueDate)}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText("依据《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》，具体以接种门诊和接种证为准。这是提醒，不是接种建议。")}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`${title} 就在明天`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function icsFileName(event: VaccineEvent): string {
  return `疫苗-${event.name}-第${event.dose}剂-${event.dueDate}.ics`;
}
