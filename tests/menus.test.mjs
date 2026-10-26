import assert from "node:assert/strict";
import test from "node:test";
import { menuSpec, webhookIdFromMenu } from "../lib/menus.js";

const CONTEXTS = ["page", "link", "selection"];
const hook = (id, name) => ({ id, name, url: `https://${id}.example/`, key: "k", createdAt: 0 });

test("no webhook: a single Save to Monica item that leads to setup", () => {
  assert.deepEqual(menuSpec({ webhooks: [], defaultWebhookId: "" }), [
    { id: "save", title: "Save to Monica", contexts: CONTEXTS },
  ]);
  assert.equal(webhookIdFromMenu("save"), "");
});

test("one webhook keeps the flat Save to Monica item", () => {
  const spec = menuSpec({ webhooks: [hook("a", "Monica 收藏")], defaultWebhookId: "a" });
  assert.deepEqual(spec, [{ id: "save:a", title: "Save to Monica", contexts: CONTEXTS }]);
  assert.equal(webhookIdFromMenu("save:a"), "a");
});

test("several webhooks become a Save to submenu in list order, default marked, no Save to all", () => {
  const spec = menuSpec({ webhooks: [hook("a", "Monica 收藏"), hook("b", "工作笔记")], defaultWebhookId: "b" });
  assert.deepEqual(spec, [
    { id: "save-to", title: "Save to", contexts: CONTEXTS },
    { id: "save:a", parentId: "save-to", title: "Monica 收藏", contexts: CONTEXTS },
    { id: "save:b", parentId: "save-to", title: "工作笔记(默认)", contexts: CONTEXTS },
  ]);
  assert.equal(spec.some((item) => /all/i.test(item.title)), false);
});

test("unknown menu ids map to nothing", () => {
  assert.equal(webhookIdFromMenu("other"), null);
  assert.equal(webhookIdFromMenu(42), null);
});
