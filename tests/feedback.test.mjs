import assert from "node:assert/strict";
import test from "node:test";
import { describeResult, headline } from "../lib/feedback.js";

const http = (status) => ({ ok: false, kind: "http", status, message: `HTTP ${status}` });

test("success names the webhook", () => {
  const view = describeResult({ ok: true, kind: "ok", status: 200 });
  assert.equal(view.tone, "ok");
  assert.equal(view.badge, "OK");
  assert.equal(headline({ ok: true, kind: "ok", status: 200 }, "Monica 收藏"), "已保存到「Monica 收藏」");
});

test("HTTP statuses map to plain-language reasons with the code", () => {
  const cases = [
    [401, "密钥或地址不对(HTTP 401)"],
    [403, "密钥或地址不对(HTTP 403)"],
    [404, "地址不存在(HTTP 404)"],
    [429, "请求过多,稍后再试(HTTP 429)"],
    [500, "Monica 服务端错误(HTTP 500)"],
    [503, "Monica 服务端错误(HTTP 503)"],
    [418, "请求失败(HTTP 418)"],
  ];
  for (const [status, text] of cases) {
    const view = describeResult(http(status));
    assert.equal(view.text, text, `status ${status}`);
    assert.equal(view.tone, "err");
    assert.equal(view.badge, String(status));
  }
});

test("timeout and network errors read as cannot connect", () => {
  const timeout = describeResult({ ok: false, kind: "timeout", status: 0 });
  assert.match(timeout.text, /^无法连接/);
  assert.match(timeout.text, /超时/);
  assert.equal(timeout.badge, "ERR");
  const network = describeResult({ ok: false, kind: "network", status: 0 });
  assert.match(network.text, /^无法连接/);
  assert.equal(network.badge, "ERR");
});

test("missing host permission offers the authorize action", () => {
  const view = describeResult({ ok: false, kind: "permission", status: 0, origin: "https://h.example/*" });
  assert.equal(view.text, "未授权访问该域名,点此授权");
  assert.equal(view.action, "authorize");
  assert.equal(view.badge, "PERM");
});

test("outside the popup the permission text does not promise a clickable link", () => {
  const result = { ok: false, kind: "permission", status: 0, origin: "https://h.example/*" };
  assert.equal(describeResult(result, { interactive: false }).text, "未授权访问该域名");
  assert.equal(headline(result, "A", { interactive: false }), "保存到「A」失败:未授权访问该域名");
});

test("config problems point to settings", () => {
  for (const kind of ["config", "missing"]) {
    const view = describeResult({ ok: false, kind, status: 0 });
    assert.equal(view.action, "configure", kind);
    assert.equal(view.badge, "CFG", kind);
  }
});

test("failure headline names the target and never echoes the raw message", () => {
  const text = headline({ ok: false, kind: "http", status: 401, message: "secret-ish body" }, "工作笔记");
  assert.equal(text, "保存到「工作笔记」失败:密钥或地址不对(HTTP 401)");
});
