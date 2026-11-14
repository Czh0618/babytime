import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const fold = read("components/HealthFold.vue");
const view = read("views/HealthView.vue");
const embeddedCards = [
  "components/HealthChecksCard.vue",
  "components/WarningSignsCard.vue",
  "components/FeedingNotesCard.vue",
  "components/AskRecordsCard.vue",
  "components/SchoolCheckCard.vue",
];

test("健康页折叠容器默认收起、不记住展开状态", () => {
  assert.match(fold, /<details class="health-fold"/);
  assert.doesNotMatch(fold, /<details[^>]*\sopen\b/);
  assert.doesNotMatch(fold, /:open=|localStorage|sessionStorage/);
  assert.match(fold, /<summary class="fold-summary">/);
  assert.match(fold, /min-height: 56px/, "触控区不小于 44px");
  assert.match(fold, /\.health-fold\[open\] \.fold-chevron/, "展开时箭头转向");
  assert.match(fold, /:deep\(\.fold-body > section\)/, "子组件卡片不留双重内边距");
  assert.doesNotMatch(view, /babytime\.healthFold|localStorage/, "不持久化展开状态");
});

test("九项功能全部折进统一容器，每项收起时都有一行概要", () => {
  const titles = [
    "疫苗计划", "体检日程", "生长曲线", "里程碑", "发育观察",
    "喂养与口腔", "问问记录", "入托入学接种核对", "自费疫苗",
  ];
  assert.equal((view.match(/<HealthFold/g) ?? []).length, 9);
  assert.equal((view.match(/<\/HealthFold>/g) ?? []).length, 9);
  for (const title of titles)
    assert.ok(view.includes(`title="${title}"`), `${title} 缺少折叠标题`);
  assert.equal(
    (view.match(/:hint="\w+"| hint="/g) ?? []).length,
    9,
    "每张卡都有概要文字",
  );
  assert.match(view, /class="health-focus"/, "顶部保留一行重点");
  assert.match(view, /下面每项默认收起，点标题展开/);
  assert.equal(
    (view.match(/class="fold-content/g) ?? []).length,
    4,
    "四张内联卡片改成折叠内容",
  );
  assert.doesNotMatch(view, /<section class="vaccine-card surface"/);
  assert.doesNotMatch(view, /<section class="growth-card surface"/);
  assert.doesNotMatch(view, /<section class="milestone-card surface"/);
  assert.doesNotMatch(view, /<section class="custom-card surface"/);
});

test("子组件都以 embedded 模式隐藏重复标题，功能入口不丢", () => {
  for (const path of embeddedCards) {
    const source = read(path);
    assert.match(source, /embedded\?: boolean;/, `${path} 缺少 embedded 开关`);
    assert.match(source, /v-if="embedded"/, `${path} 没有隐藏标题`);
    assert.match(source, /visually-hidden/, `${path} 折叠后仍保留无障碍标题`);
  }
  assert.equal((view.match(/\bembedded\b/g) ?? []).length, 5);
  assert.match(
    read("components/SchoolCheckCard.vue"),
    /class="school-print-row"/,
    "打印按钮从标题行移到内容里，折叠后仍可用",
  );
  assert.match(view, /@save="\(records\) => emit\('saveHealthChecks'/);
  assert.match(view, /@save="\(signs\) => emit\('saveWarningSigns'/);
});
