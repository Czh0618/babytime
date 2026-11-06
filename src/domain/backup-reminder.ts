/** 超过 7 天没导出备份时提醒；纯函数，便于覆盖无记录 / 刚备份 / 逾期三种情况。 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface BackupReminderInput {
  hasRecords: boolean;
  /** ISO 时间戳字符串，从未备份为 null。 */
  lastBackupAt: string | null;
  now: Date;
  /** 本次会话里家长点了「暂时不提醒」。 */
  dismissed?: boolean;
}

export function shouldRemindBackup(input: BackupReminderInput): boolean {
  if (input.dismissed || !input.hasRecords) return false;
  if (!input.lastBackupAt) return true;
  const last = Date.parse(input.lastBackupAt);
  // 时间被改坏或本机值损坏时，按「从未备份」处理更能防丢数据。
  if (Number.isNaN(last)) return true;
  return input.now.getTime() - last >= SEVEN_DAYS_MS;
}
