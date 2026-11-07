import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProfile } from "../src/domain/profile.ts";
import { isWorkspace } from "../src/domain/workspace-schema.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";

const today = "2026-11-07";

test("最小资料可用，旧数据没有新字段也通过", () => {
  assert.equal(
    validateProfile({ name: "小满", birthDate: "2026-05-01" }, today),
    null,
  );
  assert.equal(
    validateProfile(
      { name: "小满", birthDate: "2026-05-01", sex: "female" },
      today,
    ),
    null,
  );
});

test("昵称、生日与未来日期都会被拦下", () => {
  assert.match(validateProfile({ name: " ", birthDate: "2026-05-01" }, today)!, /昵称/);
  assert.match(
    validateProfile({ name: "一".repeat(31), birthDate: "2026-05-01" }, today)!,
    /30/,
  );
  assert.match(validateProfile({ name: "小满", birthDate: "" }, today)!, /出生日期/);
  assert.match(
    validateProfile({ name: "小满", birthDate: "2026-02-30" }, today)!,
    /出生日期/,
  );
  assert.match(
    validateProfile({ name: "小满", birthDate: "2026-12-01" }, today)!,
    /不能晚于今天/,
  );
});

test("性别只接受男孩或女孩", () => {
  assert.match(
    validateProfile(
      { name: "小满", birthDate: "2026-05-01", sex: "unknown" as never },
      today,
    )!,
    /男孩或女孩/,
  );
});

test("预产期：早产可用，和生日差太远要拦下", () => {
  // 34 周早产：生日 1-01，预产期 2-12 左右
  assert.equal(
    validateProfile(
      { name: "小满", birthDate: "2026-01-01", dueDate: "2026-02-12" },
      today,
    ),
    null,
  );
  assert.match(
    validateProfile(
      { name: "小满", birthDate: "2026-01-01", dueDate: "2026-11-01" },
      today,
    )!,
    /相差太大/,
  );
  assert.match(
    validateProfile(
      { name: "小满", birthDate: "2026-01-01", dueDate: "2026-13-01" },
      today,
    )!,
    /格式/,
  );
});

test("备份校验接受新字段，拒绝非法性别", () => {
  const workspace = emptyWorkspace();
  workspace.profiles[0] = { ...workspace.profiles[0]!, name: "小满", birthDate: "2026-05-01" };
  assert.equal(isWorkspace(structuredClone(workspace)), true);

  workspace.profiles[0] = {
    ...workspace.profiles[0]!,
    name: "小满",
    birthDate: "2026-05-01",
    sex: "female",
    dueDate: "2026-05-08",
  };
  assert.equal(isWorkspace(structuredClone(workspace)), true);

  const broken = structuredClone(workspace);
  broken.profiles[0]!.sex = "unknown" as never;
  assert.equal(isWorkspace(broken), false);
});
