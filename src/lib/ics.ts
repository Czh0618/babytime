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

/** P8.1：儿保体检节点也可以单独导出日历文件。 */
export interface HealthCheckEvent {
  id: string;
  name: string;
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

interface DayEvent {
  uid: string;
  title: string;
  description: string;
  dueDate: string;
  alarmText: string;
}

/** 疫苗与儿保体检共用同一个整日事件 + 提前 1 天提醒的模板。 */
function buildDayIcs(event: DayEvent, now: Date): string {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BabyTime//Vaccine Reminder//CN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(event.dueDate)}`,
    `DTEND;VALUE=DATE:${nextDay(event.dueDate)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.alarmText)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function buildVaccineIcs(event: VaccineEvent, now = new Date()): string {
  const title = `接种 ${event.name} 第 ${event.dose} 剂`;
  return buildDayIcs(
    {
      uid: `babytime-${event.code}-${event.dose}-${compact(event.dueDate)}@local`,
      title,
      description:
        "依据《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》，具体以接种门诊和接种证为准。这是提醒，不是接种建议。",
      dueDate: event.dueDate,
      alarmText: `${title} 就在明天`,
    },
    now,
  );
}

export function icsFileName(event: VaccineEvent): string {
  return `疫苗-${event.name}-第${event.dose}剂-${event.dueDate}.ics`;
}

export function buildHealthCheckIcs(
  event: HealthCheckEvent,
  now = new Date(),
): string {
  const title = `儿保体检 ${event.name}`;
  return buildDayIcs(
    {
      uid: `babytime-check-${event.id}-${compact(event.dueDate)}@local`,
      title,
      description:
        "依据《国家基本公共卫生服务规范（第三版）》的儿童健康管理时间，具体以社区卫生服务中心通知与医生安排为准。这是提醒，不是就诊建议。",
      dueDate: event.dueDate,
      alarmText: `${title} 就在明天`,
    },
    now,
  );
}

export function healthCheckIcsFileName(event: HealthCheckEvent): string {
  return `儿保-${event.name}-${event.dueDate}.ics`;
}
