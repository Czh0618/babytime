import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRemindBackup } from "../src/domain/backup-reminder.ts";

const now = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

test("没有任何记录时不打扰", () => {
  assert.equal(
    shouldRemindBackup({ hasRecords: false, lastBackupAt: null, now }),
    false,
  );
  assert.equal(
    shouldRemindBackup({ hasRecords: false, lastBackupAt: daysAgo(30), now }),
    false,
  );
});

test("刚备份过不提醒", () => {
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: daysAgo(1), now }),
    false,
  );
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: now.toISOString(), now }),
    false,
  );
});

test("8 天前备份要提醒，恰好 7 天也提醒", () => {
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: daysAgo(8), now }),
    true,
  );
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: daysAgo(7), now }),
    true,
  );
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: daysAgo(6), now }),
    false,
  );
});

test("从未备份或本机时间值损坏时按需要备份处理", () => {
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: null, now }),
    true,
  );
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: "not-a-date", now }),
    true,
  );
});

test("本次会话关闭后不再出现；时钟回拨不误报", () => {
  assert.equal(
    shouldRemindBackup({
      hasRecords: true,
      lastBackupAt: daysAgo(30),
      now,
      dismissed: true,
    }),
    false,
  );
  const future = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(
    shouldRemindBackup({ hasRecords: true, lastBackupAt: future, now }),
    false,
  );
});
