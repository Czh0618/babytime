import { test } from "node:test";
import assert from "node:assert/strict";
import { isIOS, isStandalone, migrationCopy } from "../src/domain/pwa.ts";

test("matchMedia 判定主屏幕模式，异常时安全回退", () => {
  assert.equal(isStandalone(() => ({ matches: true })), true);
  assert.equal(isStandalone(() => ({ matches: false })), false);
  assert.equal(isStandalone(() => null), false);
  assert.equal(
    isStandalone(() => {
      throw new Error("matchMedia unavailable");
    }),
    false,
  );
});

test("旧版 iOS 的 navigator.standalone 也算主屏幕", () => {
  assert.equal(isStandalone(() => ({ matches: false }), true), true);
});

test("识别 iPhone / iPad，非 iOS 不误判", () => {
  assert.ok(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"));
  assert.ok(isIOS("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"));
  assert.equal(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), false);
  assert.equal(isIOS("Mozilla/5.0 (Linux; Android 13)"), false);
});

test("Safari 与主屏幕应用显示不同文案且包含迁移三步", () => {
  const safari = migrationCopy({ standalone: false, ios: true });
  const home = migrationCopy({ standalone: true, ios: true });
  assert.notEqual(safari.title, home.title);
  assert.match(safari.title, /不互通/);
  assert.ok(safari.steps.length >= 3);
  const steps = safari.steps.join("");
  assert.match(steps, /导出备份/);
  assert.match(steps, /添加到主屏幕/);
  assert.match(steps, /从备份恢复/);
  assert.match(home.steps.join(""), /导出备份|从备份恢复/);
  assert.notEqual(safari.note, home.note);
});

test("桌面浏览器给通用的备份引导", () => {
  const desktop = migrationCopy({ standalone: false, ios: false });
  assert.match(desktop.title, /当前浏览器/);
  assert.ok(desktop.steps.length >= 2);
  assert.match(desktop.steps.join(""), /导出备份|从备份恢复/);
});
