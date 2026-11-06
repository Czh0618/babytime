import { test } from "node:test";
import assert from "node:assert/strict";
import { createId } from "../src/domain/id.ts";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("http 访问（无 crypto.randomUUID）时仍生成唯一的 UUID v4", (t) => {
  t.mock.property(Object.getPrototypeOf(crypto), "randomUUID", undefined);
  assert.equal(crypto.randomUUID, undefined);
  const ids = Array.from({ length: 1000 }, () => createId());
  for (const id of ids) assert.match(id, UUID_V4);
  assert.equal(new Set(ids).size, ids.length);
});
