import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { parseBackup } from "../src/domain/workspace-schema.ts";
import {
  PAID_VACCINES,
  PAID_VACCINE_DISCLAIMER,
  PAID_VACCINE_PRICE_HINT,
  PAID_VACCINE_SOURCE,
} from "../src/data/vaccines-paid.ts";
import {
  VACCINE_CAUTIONS,
  VACCINE_CAUTIONS_DISCLAIMER,
  VACCINE_CAUTIONS_SOURCE,
} from "../src/data/vaccine-cautions.ts";

test("自费疫苗目录：id 唯一、字段齐全、剂次数为正", () => {
  assert.ok(PAID_VACCINES.length >= 8, "目录至少要覆盖常见几支自费疫苗");
  const ids = new Set<string>();
  for (const item of PAID_VACCINES) {
    assert.ok(!ids.has(item.id), `id 重复：${item.id}`);
    ids.add(item.id);
    assert.ok(item.name.trim().length > 0, `${item.id} 缺名称`);
    assert.ok(item.protects.trim().length > 0, `${item.id} 缺预防说明`);
    assert.ok(item.schedule.trim().length > 0, `${item.id} 缺程序说明`);
    assert.ok(
      Number.isInteger(item.doses) && item.doses >= 1,
      `${item.id} 剂次数不对`,
    );
  }
});

test("自费目录不写死价格，只留边界说明与来源", () => {
  for (const item of PAID_VACCINES)
    assert.doesNotMatch(
      `${item.name}${item.schedule}${item.note ?? ""}`,
      /元/,
      `${item.id} 不该内置价格`,
    );
  assert.match(PAID_VACCINE_DISCLAIMER, /没有国家统一接种程序/);
  assert.match(PAID_VACCINE_SOURCE, /2026-11-11/);
  assert.match(PAID_VACCINE_PRICE_HINT, /门诊/);
});

test("接种注意事项三组都有内容，并标明来源与免责说明", () => {
  assert.ok(VACCINE_CAUTIONS.before.length >= 3);
  assert.ok(VACCINE_CAUTIONS.after.length >= 3);
  assert.ok(VACCINE_CAUTIONS.seekCare.length >= 2);
  assert.ok(
    VACCINE_CAUTIONS.after.some((line) => line.includes("30 分钟")),
    "接种后留观 30 分钟是官方科普的固定表述，不该丢",
  );
  assert.match(VACCINE_CAUTIONS_SOURCE, /疾控/);
  assert.match(VACCINE_CAUTIONS_SOURCE, /2026-11-11/);
  assert.match(VACCINE_CAUTIONS_DISCLAIMER, /接种门诊/);
});

test("接种记录的花费字段随备份往返，非法值被拒", () => {
  const workspace = emptyWorkspace();
  workspace.vaccinations = [
    {
      id: "v1",
      code: "custom",
      name: "13 价肺炎球菌多糖结合疫苗",
      dose: 1,
      date: "2026-11-01",
      cost: 618,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
      deviceId: "dev-a",
    },
  ];
  const restored = parseBackup(JSON.stringify(workspace));
  assert.equal(restored.vaccinations?.[0]?.cost, 618);

  const noCost = emptyWorkspace();
  noCost.vaccinations = [{ ...workspace.vaccinations[0]!, cost: undefined }];
  assert.equal(
    parseBackup(JSON.stringify(noCost)).vaccinations?.[0]?.cost,
    undefined,
    "不填花费的老记录仍然有效",
  );

  const bad = emptyWorkspace();
  bad.vaccinations = [
    { ...workspace.vaccinations[0]!, cost: "618" as unknown as number },
  ];
  assert.throws(
    () => parseBackup(JSON.stringify(bad)),
    /字段缺失、类型错误/,
    "花费必须是数字",
  );
});
