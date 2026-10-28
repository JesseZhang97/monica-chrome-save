import assert from "node:assert/strict";
import test from "node:test";
import { buildFailureRecord, clearLastFailure, loadLastFailure, saveLastFailure } from "../lib/failure.js";

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      const out = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const failed = { ok: false, kind: "http", status: 500, message: "HTTP 500", body: "server said no", key: "k" };

test("failure record keeps content, targets, time and error kind/status only", () => {
  const record = buildFailureRecord({ content: "标题: a\n链接: b", webhookIds: ["w1"], result: failed, now: 42 });
  assert.deepEqual(record, {
    content: "标题: a\n链接: b",
    webhookIds: ["w1"],
    failedAt: 42,
    error: { kind: "http", status: 500 },
  });
});

test("only the most recent failure is kept", async () => {
  const storage = fakeStorage();
  await saveLastFailure(buildFailureRecord({ content: "one", webhookIds: ["a"], result: failed, now: 1 }), storage);
  await saveLastFailure(
    buildFailureRecord({ content: "two", webhookIds: ["b"], result: { ok: false, kind: "timeout", status: 0 }, now: 2 }),
    storage
  );
  const record = await loadLastFailure(storage);
  assert.equal(record.content, "two");
  assert.deepEqual(record.webhookIds, ["b"]);
  assert.deepEqual(record.error, { kind: "timeout", status: 0 });
  assert.deepEqual(Object.keys(storage.data), ["lastFailure"]);
});

test("stored record never contains a key or response body", async () => {
  const storage = fakeStorage();
  await saveLastFailure(buildFailureRecord({ content: "x", webhookIds: ["a"], result: failed, now: 1 }), storage);
  const raw = JSON.stringify(storage.data);
  assert.equal(raw.includes("server said no"), false);
  assert.equal(raw.includes('"key"'), false);
});

test("clear removes it and malformed records load as null", async () => {
  const storage = fakeStorage({ lastFailure: { content: "", webhookIds: "nope" } });
  assert.equal(await loadLastFailure(storage), null);
  await saveLastFailure(buildFailureRecord({ content: "x", webhookIds: ["a"], result: failed, now: 1 }), storage);
  assert.notEqual(await loadLastFailure(storage), null);
  await clearLastFailure(storage);
  assert.equal(await loadLastFailure(storage), null);
  assert.deepEqual(storage.data, {});
});
