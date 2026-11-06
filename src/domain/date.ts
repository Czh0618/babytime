const pad = (value: number) => String(value).padStart(2, "0");

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTime(date = new Date()): string {
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dayAge(birthDate: string, today = localDate()): number {
  const dayNumber = (date: string) => {
    const [year, month, day] = date.slice(0, 10).split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!) / 86_400_000;
  };
  const difference = dayNumber(today) - dayNumber(birthDate);
  return Number.isFinite(difference) ? Math.max(1, difference + 1) : 1;
}

export function formatDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00` : value);
  if (Number.isNaN(date.getTime())) return "日期未填写";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatTime(value: string): string {
  if (value.length === 10) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function durationLabel(seconds = 0): string {
  return `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
}
