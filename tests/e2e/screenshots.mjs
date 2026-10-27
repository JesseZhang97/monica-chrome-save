/**
 * End-to-end run against the real unpacked extension in headless Chrome and
 * a local mock webhook. Drives popup, options and the context-menu save
 * path, asserts the outcomes, and writes screenshots to docs/screenshots/.
 *
 *   node tests/e2e/screenshots.mjs            # needs google-chrome (or CHROME_BIN)
 *
 * Limits (see README "Development"): headless Chrome has no toolbar or native
 * context menu, so the badge/tooltip are read back through chrome.action and
 * menu clicks call the same saveFromMenu() the onClicked listener uses.
 * Only dummy keys and 127.0.0.1/localhost URLs are used.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { attach, findTarget, launchChrome, sleep } from "./cdp.mjs";
import { prepareExtension, prepareExtensionAt, REPO } from "./extension-copy.mjs";
import { startMockServer } from "./mock-server.mjs";

const OUT = path.join(REPO, "docs", "screenshots");
/** Last v1 release (1.1.0), used to test the in-place upgrade. */
const V1_REF = "41d5abb";
const DUMMY_KEY = "e2e-dummy-key-not-a-secret";
const log = [];

function note(step, detail) {
  log.push({ step, ...detail });
  console.log(`ok - ${step}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
}

async function waitFor(session, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await session.evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${expression}`);
}

/**
 * Capture the whole content. The toolbar popup sizes its own window to the
 * content (and rejects metrics overrides), so it is captured as-is once the
 * resize settles; tabs get a viewport sized to the content.
 */
async function shoot(session, name, { width, height, popup = false } = {}) {
  // The key must never be on screen in any captured state.
  assert.equal(await session.evaluate(`document.body.innerText.includes(${JSON.stringify(DUMMY_KEY)})`), false);
  const bodyHeight = "Math.ceil(document.body.getBoundingClientRect().height)";
  if (popup) {
    await waitFor(session, `innerHeight >= ${bodyHeight} - 1`, 2000).catch(() => {});
    await sleep(150);
  } else {
    const metrics = (h) =>
      session.call("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: false });
    await metrics(height ?? 600);
    await metrics(height ?? (await session.evaluate(bodyHeight)));
    await sleep(120);
  }
  const { data } = await session.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  const file = path.join(OUT, `${name}.jpg`);
  writeFileSync(file, Buffer.from(data, "base64"));
  note(`screenshot ${name}.jpg`);
}

mkdirSync(OUT, { recursive: true });
const mock = await startMockServer();
const browser = await launchChrome();
let failed = false;

try {
  // ---- v1 -> v2 upgrade: install v1, configure it the v1 way, update in place ----
  const extDir = prepareExtensionAt(V1_REF);
  const { id: extId } = await browser.send("Extensions.loadUnpacked", { path: extDir });
  const findWorker = () => findTarget(browser, (t) => t.type === "service_worker" && t.url.includes(extId));
  let sw = await attach(browser, (await findWorker()).targetId);
  const v1Version = await sw.evaluate("chrome.runtime.getManifest().version");
  await sw.evaluate(`chrome.storage.local.set({ webhookUrl: "${mock.origin}/ok", webhookKey: "${DUMMY_KEY}" })`);
  prepareExtension(extDir);
  const reloaded = await browser.send("Extensions.loadUnpacked", { path: extDir });
  assert.equal(reloaded.id, extId);
  await sleep(1000);
  sw = await attach(browser, (await findWorker()).targetId);
  await waitFor(sw, "chrome.storage.local.get(null).then((d) => Array.isArray(d.webhooks))");
  const migrated = await sw.evaluate("chrome.storage.local.get(null)");
  assert.deepEqual(Object.keys(migrated).sort(), ["defaultWebhookId", "webhooks"]);
  assert.equal(migrated.webhooks[0].name, "Monica");
  assert.equal(migrated.webhooks[0].url, `${mock.origin}/ok`);
  assert.equal(migrated.defaultWebhookId, migrated.webhooks[0].id);
  const version = await sw.evaluate("chrome.runtime.getManifest().version");
  note("upgrade migration: v1 webhookUrl/webhookKey became default webhook 'Monica', legacy keys removed", {
    from: `${V1_REF} (${v1Version})`,
    to: version,
  });
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;

  const hook = (id, name, scenario) => ({
    id,
    name,
    url: scenario === "unauthorized" ? `http://localhost:${mock.port}/ok` : `${mock.origin}/${scenario}`,
    key: DUMMY_KEY,
    createdAt: 1,
  });
  const setStorage = (data) => sw.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set(${JSON.stringify(data)}))`);

  // ---- page to save from -----------------------------------------------------
  const { targetId: pageTarget } = await browser.send("Target.createTarget", { url: `${mock.origin}/page` });
  const page = await attach(browser, pageTarget);
  await page.call("Emulation.setDeviceMetricsOverride", { width: 960, height: 420, deviceScaleFactor: 1, mobile: false });
  await sleep(500);

  let popup = null;
  async function openPopup() {
    if (popup) await browser.send("Target.closeTarget", { targetId: popup.targetId }).catch(() => {});
    await browser.send("Target.activateTarget", { targetId: pageTarget });
    await sleep(150);
    await sw.evaluate("chrome.action.openPopup()");
    const info = await findTarget(browser, (t) => t.url === extUrl("popup.html"));
    popup = await attach(browser, info.targetId);
    await waitFor(popup, "document.readyState === 'complete' && !!document.querySelector('#form:not([hidden]), #setup:not([hidden])')");
    await sleep(200);
    return popup;
  }

  async function sendAndSettle(p) {
    await p.evaluate("document.getElementById('send').click()");
    await waitFor(p, "['done','failed'].includes(document.getElementById('send').dataset.state)", 20000);
  }

  async function formOutcome(p) {
    return p.evaluate("({ rows: document.querySelector('.results').innerText, status: document.getElementById('status').innerText, button: document.getElementById('send-label').textContent })");
  }

  function assertNoSummary(snap, label) {
    assert.equal(snap.status, "", `${label} still has a summary line: ${JSON.stringify(snap)}`);
  }

  // ---- popup: no webhook yet ------------------------------------------------
  await setStorage({});
  let p = await openPopup();
  assert.equal(await p.evaluate("document.getElementById('setup').hidden"), false);
  await shoot(p, "popup-empty", { popup: true });

  // ---- popup: single target, success / 401 / 500 / network / timeout ----------
  for (const [scenario, expectText] of [
    ["ok", "已保存"],
    ["401", "密钥或地址不对(HTTP 401)"],
    ["500", "Monica 服务端错误(HTTP 500)"],
    ["drop", "无法连接"],
  ]) {
    await setStorage({ webhooks: [hook("a", "Monica 收藏", scenario)], defaultWebhookId: "a" });
    p = await openPopup();
    assert.match(await p.evaluate("document.getElementById('content').value"), /^标题: 示例文章:如何整理网页收藏\n链接: http:\/\/127\.0\.0\.1:\d+\/page$/);
    await sendAndSettle(p);
    const snap = await formOutcome(p);
    assert.ok(snap.rows.includes(expectText), `${scenario}: ${snap.rows}`);
    assertNoSummary(snap, `popup ${scenario}`);
    if (scenario === "ok") {
      assert.equal(snap.button, "已保存");
    } else {
      assert.equal(snap.button, "重试");
      assert.ok((await p.evaluate("document.getElementById('content').value")).startsWith("标题:"), "content kept");
    }
    await shoot(p, scenario === "ok" ? "popup-success" : scenario === "drop" ? "popup-network" : `popup-${scenario}`, { popup: true });
    note(`popup ${scenario}`, { text: `${snap.rows} | ${snap.button}`.replace(/\s+/g, " ").trim() });
  }

  // Timeout: capture the loading state, then the 15 s timeout failure.
  await setStorage({ webhooks: [hook("a", "Monica 收藏", "slow")], defaultWebhookId: "a" });
  p = await openPopup();
  await p.evaluate("document.getElementById('send').click()");
  await sleep(400);
  assert.equal(await p.evaluate("document.getElementById('send').getAttribute('aria-busy')"), "true");
  assert.equal(await p.evaluate("document.getElementById('send').disabled"), true);
  assert.equal(await p.evaluate("document.getElementById('status').innerText"), "");
  await p.evaluate("document.getElementById('send').click()");
  await shoot(p, "popup-sending", { popup: true });
  const started = Date.now();
  await waitFor(p, "document.getElementById('send').dataset.state === 'failed'", 20000);
  const waited = Date.now() - started;
  assert.ok(await p.evaluate("document.querySelector('.results').innerText.includes('请求超时')"));
  assertNoSummary(await formOutcome(p), "popup timeout");
  assert.equal(mock.requests.filter((r) => r.path === "/slow").length, 1, "double submit was blocked");
  await shoot(p, "popup-timeout", { popup: true });
  note("popup timeout", { approxMs: waited + 400 });

  // Retry after a failure resends to the failed target with the edited content.
  mock.requests.length = 0;
  await setStorage({ webhooks: [hook("a", "Monica 收藏", "500")], defaultWebhookId: "a" });
  p = await openPopup();
  await sendAndSettle(p);
  assertNoSummary(await formOutcome(p), "popup 500 before retry");
  await p.evaluate("(() => { const t = document.getElementById('content'); t.value += '\\n\\n补一句备注'; t.dispatchEvent(new Event('input')); })()");
  await p.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))");
  await waitFor(p, "document.getElementById('send').dataset.state === 'failed' && document.querySelectorAll('.result').length === 1");
  assert.equal(mock.requests.length, 2);
  assert.ok(mock.requests[1].content.endsWith("补一句备注"));
  assertNoSummary(await formOutcome(p), "popup retry");
  note("popup retry via Ctrl+Enter resent edited content", { requests: mock.requests.length });

  // ---- popup: multi-target mixed results ---------------------------------
  const many = [
    hook("a", "Monica 收藏", "ok"),
    hook("b", "工作笔记", "401"),
    hook("c", "稍后读", "500"),
    hook("d", "家里 NAS", "drop"),
    hook("e", "测试环境", "unauthorized"),
  ];
  await setStorage({ webhooks: many, defaultWebhookId: "a" });
  p = await openPopup();
  assert.deepEqual(
    await p.evaluate("[...document.querySelectorAll('#picker-list input:checked')].map((i) => i.value)"),
    ["a"],
    "default webhook preselected"
  );
  await p.evaluate("document.querySelector('#picker summary').click()");
  await p.evaluate("document.querySelectorAll('#picker-list input').forEach((i) => { if (!i.checked) i.click(); })");
  await shoot(p, "popup-targets", { popup: true });
  await p.evaluate("document.querySelector('#picker summary').click()");
  mock.requests.length = 0;
  await sendAndSettle(p);
  const rows = await p.evaluate("[...document.querySelectorAll('.result')].map((r) => [r.dataset.state, r.querySelector('.result-name').textContent])");
  assert.deepEqual(rows, [
    ["ok", "Monica 收藏"],
    ["err", "工作笔记"],
    ["err", "稍后读"],
    ["err", "家里 NAS"],
    ["warn", "测试环境"],
  ]);
  assert.deepEqual(
    mock.requests.map((r) => r.path).filter((x, i, a) => a.indexOf(x) === i),
    ["/ok", "/401", "/500", "/drop"],
    "sent one by one in list order; unauthorized origin never contacted"
  );
  assert.ok(mock.requests.every((r) => r.method === "POST" && r.bearer && r.bodyKeys?.join() === "content"));
  assert.equal(await p.evaluate("document.getElementById('send-label').textContent"), "重试 4 个失败项");
  assertNoSummary(await formOutcome(p), "popup multi-target");
  await shoot(p, "popup-multi-mixed", { popup: true });
  note("popup multi-target", { rows });

  // Selection is remembered for the next popup.
  p = await openPopup();
  assert.equal(await p.evaluate("document.querySelectorAll('#picker-list input:checked').length"), 5);
  note("popup remembers last selection");

  // ---- context menu -------------------------------------------------------
  const menuItems = await sw.evaluate(`(async () => {
    const made = [];
    const original = chrome.contextMenus.create.bind(chrome.contextMenus);
    chrome.contextMenus.create = (item, cb) => { made.push(item.parentId ? item.parentId + " > " + item.title : item.title); return original(item, cb); };
    await chrome.storage.local.set({ defaultWebhookId: "b" });
    await new Promise((r) => setTimeout(r, 400));
    chrome.contextMenus.create = original;
    return made;
  })()`);
  assert.deepEqual(menuItems, ["Save to", "save-to > Monica 收藏", "save-to > 工作笔记(默认)", "save-to > 稍后读", "save-to > 家里 NAS", "save-to > 测试环境"]);
  note("context menu rebuilt as submenu", { menuItems });

  const { targetId: optTarget } = await browser.send("Target.createTarget", { url: extUrl("options.html") });
  const opt = await attach(browser, optTarget);
  await sleep(600);
  const menuSave = (menuItemId, restricted = false) =>
    opt.evaluate(`(async () => {
      const { saveFromMenu } = await import("/lib/menu-save.js");
      const tabs = await chrome.tabs.query({});
      const tab = ${restricted} ? tabs.sort((x, y) => y.id - x.id)[0] : (await chrome.tabs.query({ url: "${mock.origin}/page" }))[0];
      const pageUrl = ${restricted} ? "chrome://version/" : tab.url;
      const r = await saveFromMenu({ menuItemId: "${menuItemId}", pageUrl }, tab);
      return {
        result: { ok: r.ok, kind: r.kind, status: r.status },
        badge: await chrome.action.getBadgeText({}),
        title: await chrome.action.getTitle({}),
        failure: (await chrome.storage.local.get("lastFailure")).lastFailure ?? null,
      };
    })()`);

  await browser.send("Target.activateTarget", { targetId: pageTarget });
  let r = await menuSave("save:a");
  assert.equal(r.badge, "OK");
  assert.match(r.title, /已保存到「Monica 收藏」/);
  assert.equal(r.failure, null);
  await browser.send("Target.activateTarget", { targetId: pageTarget });
  await sleep(200);
  await shoot(page, "menu-toast-success", { width: 960, height: 360 });
  note("menu save success", { badge: r.badge, title: r.title });

  r = await menuSave("save:b");
  assert.equal(r.badge, "401");
  assert.match(r.title, /保存到「工作笔记」失败:密钥或地址不对\(HTTP 401\)/);
  assert.deepEqual(r.failure.webhookIds, ["b"]);
  assert.deepEqual(r.failure.error, { kind: "http", status: 401 });
  assert.equal(JSON.stringify(r.failure).includes(DUMMY_KEY), false);
  await browser.send("Target.activateTarget", { targetId: pageTarget });
  await sleep(200);
  await shoot(page, "menu-toast-401", { width: 960, height: 360 });
  note("menu save 401 kept failure", { badge: r.badge, failure: { ...r.failure, content: r.failure.content.slice(0, 20) + "…" } });

  await browser.send("Target.createTarget", { url: "chrome://version/" });
  await sleep(600);
  r = await menuSave("save:c", true);
  assert.equal(r.badge, "500");
  assert.match(r.title, /保存到「稍后读」失败:Monica 服务端错误\(HTTP 500\)\n内容已保留,打开扩展可重发/);
  assert.deepEqual(r.failure.webhookIds, ["c"]);
  await sleep(3600);
  assert.equal(await opt.evaluate("chrome.action.getBadgeText({})"), "500", "failure badge stays until the popup opens");
  note("menu save on chrome:// page: badge + tooltip only", { badge: r.badge, title: r.title });

  // ---- popup: resend the kept failure ---------------------------------------
  await opt.evaluate(`(async () => {
    const d = await chrome.storage.local.get("webhooks");
    d.webhooks.find((w) => w.id === "c").url = "${mock.origin}/ok";
    await chrome.storage.local.set(d);
  })()`);
  p = await openPopup();
  assert.equal(await p.evaluate("document.getElementById('recover').hidden"), false);
  assert.equal(await opt.evaluate("chrome.action.getBadgeText({})"), "", "popup cleared the badge");
  await shoot(p, "popup-last-failure", { popup: true });
  mock.requests.length = 0;
  await p.evaluate("document.getElementById('recover-retry').click()");
  await waitFor(p, "document.getElementById('recover-status').dataset.kind === 'ok'");
  assert.equal(mock.requests.length, 1);
  assert.match(mock.requests[0].content, /^标题: .*\n链接: chrome:\/\/version\/$/);
  await shoot(p, "popup-last-failure-resent", { popup: true });
  assert.equal(await opt.evaluate("chrome.storage.local.get('lastFailure').then((d) => d.lastFailure ?? null)"), null);
  note("popup resent kept failure and cleared it");

  // ---- options page -----------------------------------------------------------
  // Foreground the tab like a user would; a background tab never delivers the dialog's close event here.
  await browser.send("Target.activateTarget", { targetId: optTarget });
  await opt.call("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await setStorage({});
  await opt.call("Page.reload");
  await sleep(700);
  assert.equal(await opt.evaluate("document.getElementById('empty').hidden"), false);
  await shoot(opt, "options-empty", { width: 900 });

  const fill = (fields) =>
    opt.evaluate(`(() => { const v = ${JSON.stringify(fields)}; for (const k in v) document.getElementById(k).value = v[k]; document.getElementById('form').requestSubmit(); })()`, { userGesture: true });
  await opt.evaluate("document.getElementById('add-empty').click()");
  await fill({ name: "Monica 收藏", url: `${mock.origin}/ok`, key: DUMMY_KEY });
  await sleep(400);
  await opt.evaluate("document.getElementById('add').click()");
  await fill({ name: "  monica 收藏 ", url: "ftp://example.com/x", key: "" });
  await sleep(200);
  const errors = await opt.evaluate("['name', 'url', 'key'].map((n) => document.getElementById(n + '-error').textContent)");
  assert.deepEqual(errors, ["已有同名的 webhook", "只支持 http:// 或 https:// 地址", "请填写 Bearer key"]);
  assert.equal(await opt.evaluate("document.activeElement.id"), "name");
  await shoot(opt, "options-validation", { width: 900 });
  note("options validation", { errors });

  await fill({ name: "工作笔记", url: `${mock.origin}/401`, key: DUMMY_KEY });
  await sleep(400);
  // An ungranted origin would open Chrome's permission prompt, which headless
  // Chrome cannot answer, so this one is written to storage directly.
  await opt.evaluate(`(async () => {
    const d = await chrome.storage.local.get(["webhooks"]);
    d.webhooks.push(${JSON.stringify(hook("e", "测试环境", "unauthorized"))});
    await chrome.storage.local.set(d);
  })()`);
  await sleep(400);
  await opt.evaluate("document.querySelectorAll('[data-action=test]')[0].click()", { userGesture: true });
  await sleep(400);
  await opt.evaluate("document.querySelectorAll('[data-action=test]')[1].click()", { userGesture: true });
  await sleep(400);
  const statuses = await opt.evaluate("[...document.querySelectorAll('.hook')].map((r) => [r.querySelector('.name').textContent, r.querySelector('.hook-status').textContent])");
  assert.equal(statuses[0][1], "HTTP 200");
  assert.equal(statuses[1][1], "HTTP 401");
  assert.match(statuses[2][1], /未授权/);
  await shoot(opt, "options-list", { width: 900 });
  note("options list + per-row Test", { statuses });

  await opt.evaluate("document.querySelectorAll('[data-action=delete]')[1].click()");
  await sleep(200);
  assert.equal(await opt.evaluate("document.getElementById('confirm').open"), true);
  await shoot(opt, "options-delete-confirm", { width: 900, height: 760 });
  await opt.evaluate("document.querySelector('#confirm button[value=delete]').click()");
  await waitFor(opt, "document.getElementById('page-status').textContent.startsWith('已删除')");
  const left = await opt.evaluate("chrome.storage.local.get('webhooks').then((d) => d.webhooks.map((w) => w.name))");
  assert.deepEqual(left, ["Monica 收藏", "测试环境"]);
  note("options delete with confirm", { left });

  writeFileSync(path.join(OUT, "e2e-log.json"), JSON.stringify(log, null, 2) + "\n");
  console.log(`\nall e2e checks passed; ${log.filter((l) => l.step.startsWith("screenshot")).length} screenshots in docs/screenshots/`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
  await mock.close();
}
process.exit(failed ? 1 : 0);
