import { test } from "node:test";
import assert from "node:assert/strict";
import { clipAction } from "../src/domain/clip.ts";

test("没有片段范围时不干预播放器", () => {
  for (const event of ["metadata", "play", "timeupdate"] as const) {
    assert.equal(clipAction(0, {}, event), null);
    assert.equal(clipAction(95, {}, event), null);
  }
});

test("元数据就绪后把播放头定位到片段起点", () => {
  assert.deepEqual(clipAction(0, { start: 4, end: 20 }, "metadata"), {
    seekTo: 4,
  });
  // 已经在片段里就不再回拖，否则 seek 过后再触发 loadeddata 会被拉回开头。
  assert.equal(clipAction(8, { start: 4, end: 20 }, "metadata"), null);
});

test("播放到片段结束点暂停", () => {
  assert.deepEqual(clipAction(20, { start: 4, end: 20 }, "timeupdate"), {
    pause: true,
  });
  assert.equal(clipAction(19.9, { start: 4, end: 20 }, "timeupdate"), null);
});

test("播完再点播放从片段起点重播", () => {
  assert.deepEqual(clipAction(20, { start: 4, end: 20 }, "play"), {
    seekTo: 4,
  });
  assert.equal(clipAction(8, { start: 4, end: 20 }, "play"), null);
});

test("片段数据异常时播完整段，不把播放器卡死", () => {
  assert.equal(clipAction(30, { start: 10, end: 5 }, "timeupdate"), null);
  assert.equal(clipAction(30, { start: NaN, end: 20 }, "timeupdate"), null);
  assert.equal(clipAction(30, { end: Infinity }, "timeupdate"), null);
  assert.equal(clipAction(NaN, { start: 4, end: 20 }, "metadata"), null);
});
