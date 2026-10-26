import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_WEBHOOK_ID,
  addWebhook,
  migrateStorage,
  normalizeState,
  originsToRevoke,
  removeWebhook,
  resolveDefault,
  setDefaultWebhook,
  updateWebhook,
  validateWebhook,
} from "../lib/webhooks.js";
import { loadState, saveState } from "../lib/store.js";

const NOW = 1_700_000_000_000;

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
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

function stateWith(...hooks) {
  let state = { webhooks: [], defaultWebhookId: "" };
  hooks.forEach((h, i) => {
    const r = addWebhook(state, h, { id: `id${i + 1}`, now: NOW + i });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    state = r.state;
  });
  return state;
}

test("validateWebhook requires name, url and key", () => {
  const r = validateWebhook({ name: " ", url: "", key: "" }, []);
  assert.equal(r.ok, false);
  assert.ok(r.errors.name);
  assert.ok(r.errors.url);
  assert.ok(r.errors.key);
});

test("validateWebhook rejects non-http(s) and malformed URLs", () => {
  assert.ok(validateWebhook({ name: "a", url: "ftp://x", key: "k" }, []).errors.url);
  assert.ok(validateWebhook({ name: "a", url: "not a url", key: "k" }, []).errors.url);
  assert.equal(validateWebhook({ name: "a", url: "http://127.0.0.1:9/x", key: "k" }, []).ok, true);
});

test("names are unique case-insensitively after trimming", () => {
  const state = stateWith({ name: "Monica 收藏", url: "https://a.example/h", key: "k1" });
  const dup = addWebhook(state, { name: "  monica   收藏 ", url: "https://b.example/h", key: "k2" }, { id: "x", now: NOW });
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.name);
  assert.equal(dup.state, state);
});

test("editing may keep its own name and blank key keeps the stored key", () => {
  const state = stateWith({ name: "工作笔记", url: "https://a.example/h", key: "secret-1" });
  const r = updateWebhook(state, "id1", { name: "工作笔记", url: "https://a.example/h2", key: "" });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.webhook.key, "secret-1");
  assert.equal(r.webhook.url, "https://a.example/h2");
  assert.equal(r.webhook.createdAt, NOW);
});

test("editing to another webhook's name is rejected", () => {
  const state = stateWith(
    { name: "A", url: "https://a.example/", key: "k" },
    { name: "B", url: "https://b.example/", key: "k" }
  );
  const r = updateWebhook(state, "id2", { name: "a", url: "https://b.example/", key: "" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.name);
});

test("first webhook becomes default; setDefault switches; remove reassigns default", () => {
  let state = stateWith(
    { name: "A", url: "https://a.example/", key: "k" },
    { name: "B", url: "https://b.example/", key: "k" }
  );
  assert.equal(state.defaultWebhookId, "id1");
  state = setDefaultWebhook(state, "id2");
  assert.equal(resolveDefault(state).name, "B");
  assert.equal(setDefaultWebhook(state, "missing"), state);
  const removed = removeWebhook(state, "id2");
  assert.equal(removed.removed.name, "B");
  assert.deepEqual(removed.state.webhooks.map((w) => w.id), ["id1"]);
  assert.equal(removed.state.defaultWebhookId, "id1");
  const empty = removeWebhook(removed.state, "id1").state;
  assert.deepEqual(empty, { webhooks: [], defaultWebhookId: "" });
  assert.equal(resolveDefault(empty), null);
});

test("originsToRevoke keeps origins still used by another webhook", () => {
  const state = stateWith(
    { name: "A", url: "https://hooks.example/a", key: "k" },
    { name: "B", url: "https://hooks.example/b", key: "k" },
    { name: "C", url: "http://127.0.0.1:8080/c", key: "k" }
  );
  const afterB = removeWebhook(state, "id2").state;
  assert.deepEqual(originsToRevoke(state.webhooks, afterB.webhooks), []);
  const afterAB = removeWebhook(afterB, "id1").state;
  assert.deepEqual(originsToRevoke(afterB.webhooks, afterAB.webhooks), ["https://hooks.example/*"]);
});

test("normalizeState drops malformed entries and repairs a dangling default", () => {
  const state = normalizeState({
    webhooks: [
      { id: "a", name: "A", url: "https://a.example/", key: "k", createdAt: 1 },
      null,
      { id: "", name: "nope" },
      "junk",
    ],
    defaultWebhookId: "gone",
  });
  assert.deepEqual(state.webhooks.map((w) => w.id), ["a"]);
  assert.equal(state.defaultWebhookId, "a");
  assert.deepEqual(normalizeState(undefined), { webhooks: [], defaultWebhookId: "" });
});

test("migrateStorage turns legacy url/key into a default webhook named Monica", () => {
  const plan = migrateStorage({ webhookUrl: " https://hook.example/x ", webhookKey: " k " }, { now: NOW });
  assert.deepEqual(plan.set, {
    webhooks: [{ id: LEGACY_WEBHOOK_ID, name: "Monica", url: "https://hook.example/x", key: "k", createdAt: NOW }],
    defaultWebhookId: LEGACY_WEBHOOK_ID,
  });
  assert.deepEqual(plan.remove.sort(), ["webhookKey", "webhookUrl"]);
});

test("migrateStorage is a no-op without legacy keys and never overwrites a webhooks list", () => {
  assert.deepEqual(migrateStorage({}, { now: NOW }), { set: null, remove: [] });
  const existing = { webhooks: [{ id: "z", name: "Z", url: "https://z.example/", key: "k", createdAt: 1 }], defaultWebhookId: "z" };
  const plan = migrateStorage({ ...existing, webhookUrl: "https://old.example/", webhookKey: "old" }, { now: NOW });
  assert.equal(plan.set, null);
  assert.deepEqual(plan.remove.sort(), ["webhookKey", "webhookUrl"]);
  const blank = migrateStorage({ webhookUrl: "", webhookKey: "" }, { now: NOW });
  assert.equal(blank.set, null);
  assert.deepEqual(blank.remove.sort(), ["webhookKey", "webhookUrl"]);
});

test("loadState migrates legacy storage once and is idempotent", async () => {
  const storage = fakeStorage({ webhookUrl: "https://hook.example/x", webhookKey: "legacy-key" });
  const first = await loadState(storage, { now: NOW });
  assert.equal(first.webhooks.length, 1);
  assert.equal(first.webhooks[0].name, "Monica");
  assert.equal(first.defaultWebhookId, LEGACY_WEBHOOK_ID);
  assert.equal("webhookUrl" in storage.data, false);
  assert.equal("webhookKey" in storage.data, false);
  const snapshot = structuredClone(storage.data);
  const second = await loadState(storage, { now: NOW + 999 });
  assert.deepEqual(second, first);
  assert.deepEqual(storage.data, snapshot);
});

test("saveState round-trips through loadState", async () => {
  const storage = fakeStorage();
  const state = stateWith({ name: "A", url: "https://a.example/", key: "k" });
  await saveState(state, storage);
  assert.deepEqual(await loadState(storage), state);
});
