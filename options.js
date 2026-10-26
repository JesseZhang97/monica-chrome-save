import { buildContent, postToMonica } from "./lib/protocol.js";
import { isStateChange, loadState, saveState } from "./lib/store.js";
import {
  addWebhook,
  findWebhook,
  originsToRevoke,
  removeWebhook,
  setDefaultWebhook,
  updateWebhook,
  validateWebhook,
  webhookOrigin,
} from "./lib/webhooks.js";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const rowTpl = document.getElementById("row");
const pageStatusEl = document.getElementById("page-status");
const editorEl = document.getElementById("editor");
const editorTitleEl = document.getElementById("editor-title");
const formEl = document.getElementById("form");
const formStatusEl = document.getElementById("form-status");
const keyHintEl = document.getElementById("key-hint");
const makeDefaultEl = document.getElementById("makeDefault");
const confirmEl = document.getElementById("confirm");
const confirmTextEl = document.getElementById("confirm-text");
const fields = {
  name: document.getElementById("name"),
  url: document.getElementById("url"),
  key: document.getElementById("key"),
};

const KEY_HINT_NEW = "只保存在本机,不会显示或上传到别处。";
const KEY_HINT_EDIT = "留空则保留原来的 key。只保存在本机,不会显示或上传到别处。";

let state = { webhooks: [], defaultWebhookId: "" };
let editingId = null;
let returnFocusTo = null;
/** Per-row feedback that should survive re-renders: id -> { text, kind }. */
const rowStatus = new Map();
/** Origins this extension can currently reach, refreshed on every render. */
let granted = new Set();

function setStatus(el, text, kind) {
  el.textContent = text;
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function refreshGrants() {
  const origins = [...new Set(state.webhooks.map(webhookOrigin).filter(Boolean))];
  const checks = await Promise.all(origins.map((o) => chrome.permissions.contains({ origins: [o] })));
  granted = new Set(origins.filter((_, i) => checks[i]));
}

function render() {
  emptyEl.hidden = state.webhooks.length > 0;
  document.getElementById("add").hidden = state.webhooks.length === 0;
  listEl.replaceChildren(
    ...state.webhooks.map((hook) => {
      const row = rowTpl.content.firstElementChild.cloneNode(true);
      const isDefault = hook.id === state.defaultWebhookId;
      row.dataset.id = hook.id;
      row.querySelector(".name").textContent = hook.name;
      row.querySelector(".pill").hidden = !isDefault;
      row.querySelector(".host").textContent = hostOf(hook.url);
      row.querySelector('[data-action="default"]').hidden = isDefault;
      for (const button of row.querySelectorAll("button[data-action]")) {
        button.setAttribute("aria-label", `${button.textContent}「${hook.name}」`);
      }
      const status = rowStatus.get(hook.id);
      const origin = webhookOrigin(hook);
      const statusEl = row.querySelector(".hook-status");
      if (status) setStatus(statusEl, status.text, status.kind);
      else if (origin && !granted.has(origin)) setStatus(statusEl, "未授权访问该域名,点“测试”或“编辑 → 保存”授权", "warn");
      return row;
    })
  );
}

async function refresh() {
  state = await loadState();
  await refreshGrants();
  render();
}

/** Ask for the webhook origin. Must run inside the click/submit that the user made. */
async function requestOrigin(url) {
  const origin = webhookOrigin({ url });
  if (!origin) return false;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch (error) {
    console.warn("Save To Monica: permission request failed", error);
    return false;
  }
}

/** Drop host access nobody needs any more. Best effort: the list change is already saved. */
async function revokeUnused(before, after) {
  for (const origin of originsToRevoke(before, after)) {
    try {
      await chrome.permissions.remove({ origins: [origin] });
    } catch (error) {
      console.warn(`Save To Monica: could not release ${origin}`, error);
    }
  }
}

function showFieldErrors(errors) {
  let first = null;
  for (const [name, input] of Object.entries(fields)) {
    const message = errors[name] || "";
    document.getElementById(`${name}-error`).textContent = message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (message && !first) first = input;
  }
  first?.focus();
}

function openEditor(id = null, opener = null) {
  editingId = id;
  returnFocusTo = opener;
  const hook = id ? findWebhook(state, id) : null;
  editorTitleEl.textContent = hook ? `编辑「${hook.name}」` : "添加 webhook";
  fields.name.value = hook?.name ?? (state.webhooks.length ? "" : "Monica");
  fields.url.value = hook?.url ?? "";
  fields.key.value = "";
  fields.key.placeholder = hook ? "••••••••(留空保持不变)" : "粘贴 key";
  keyHintEl.textContent = hook ? KEY_HINT_EDIT : KEY_HINT_NEW;
  makeDefaultEl.checked = hook ? hook.id === state.defaultWebhookId : state.webhooks.length === 0;
  makeDefaultEl.disabled = state.webhooks.length === 0 || (hook && hook.id === state.defaultWebhookId);
  showFieldErrors({});
  setStatus(formStatusEl, "");
  editorEl.hidden = false;
  editorEl.scrollIntoView({ block: "nearest" });
  fields.name.focus();
}

function closeEditor() {
  editorEl.hidden = true;
  editingId = null;
  fields.key.value = "";
  const target = returnFocusTo?.isConnected ? returnFocusTo : document.getElementById(state.webhooks.length ? "add" : "add-empty");
  returnFocusTo = null;
  target?.focus();
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = { name: fields.name.value, url: fields.url.value, key: fields.key.value };
  const check = validateWebhook(input, state.webhooks, { id: editingId ?? undefined });
  if (!check.ok) {
    showFieldErrors(check.errors);
    return;
  }
  showFieldErrors({});

  // Request first, while the submit still counts as a user gesture.
  const allowed = await requestOrigin(check.value.url);

  const before = state;
  const result = editingId
    ? updateWebhook(before, editingId, input)
    : addWebhook(before, input, { id: crypto.randomUUID(), now: Date.now() });
  if (!result.ok) {
    showFieldErrors(result.errors);
    if (result.errors.form) setStatus(formStatusEl, result.errors.form, "err");
    return;
  }
  let next = result.state;
  if (makeDefaultEl.checked) next = setDefaultWebhook(next, result.webhook.id);
  await saveState(next);
  state = next;
  await revokeUnused(before.webhooks, next.webhooks);

  rowStatus.set(
    result.webhook.id,
    allowed
      ? { text: "已保存", kind: "ok" }
      : { text: "已保存,但未授权访问该域名,发送会被 Chrome 拦截", kind: "warn" }
  );
  await refreshGrants();
  render();
  const savedId = result.webhook.id;
  closeEditor();
  listEl.querySelector(`[data-id="${CSS.escape(savedId)}"] [data-action="test"]`)?.focus();
});

document.getElementById("cancel").addEventListener("click", closeEditor);
formEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeEditor();
  }
});
document.getElementById("add").addEventListener("click", (e) => openEditor(null, e.currentTarget));
document.getElementById("add-empty").addEventListener("click", (e) => openEditor(null, e.currentTarget));

async function testWebhook(hook, button) {
  const allowed = await requestOrigin(hook.url);
  if (!allowed) {
    rowStatus.set(hook.id, { text: "未授权访问该域名", kind: "err" });
    render();
    return;
  }
  button.disabled = true;
  button.textContent = "测试中…";
  rowStatus.set(hook.id, { text: "正在测试…", kind: "" });
  render();
  const result = await postToMonica({
    webhookUrl: hook.url,
    webhookKey: hook.key,
    content: buildContent({ title: "Save To Monica · 连接测试", url: "https://example.com/", selection: "" }),
  });
  // Status code only: never the key or the response body.
  rowStatus.set(
    hook.id,
    result.status ? { text: `HTTP ${result.status}`, kind: result.ok ? "ok" : "err" } : { text: "无法连接", kind: "err" }
  );
  await refreshGrants();
  render();
  listEl.querySelector(`[data-id="${CSS.escape(hook.id)}"] [data-action="test"]`)?.focus();
}

async function confirmDelete(hook) {
  confirmTextEl.textContent = `删除后,右键菜单和弹窗里将不再出现「${hook.name}」。此操作无法撤销。`;
  confirmEl.returnValue = "";
  confirmEl.showModal();
  await new Promise((resolve) => confirmEl.addEventListener("close", resolve, { once: true }));
  return confirmEl.returnValue === "delete";
}

listEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.closest(".hook").dataset.id;
  const hook = findWebhook(state, id);
  if (!hook) return;
  const action = button.dataset.action;

  if (action === "edit") openEditor(id, button);
  else if (action === "test") await testWebhook(hook, button);
  else if (action === "default") {
    state = setDefaultWebhook(state, id);
    await saveState(state);
    setStatus(pageStatusEl, `已将「${hook.name}」设为默认`, "ok");
    render();
    listEl.querySelector(`[data-id="${CSS.escape(id)}"] [data-action="edit"]`)?.focus();
  } else if (action === "delete") {
    if (!(await confirmDelete(hook))) {
      button.focus();
      return;
    }
    const before = state;
    state = removeWebhook(before, id).state;
    await saveState(state);
    rowStatus.delete(id);
    if (editingId === id) closeEditor();
    await revokeUnused(before.webhooks, state.webhooks);
    setStatus(pageStatusEl, `已删除「${hook.name}」`, "ok");
    await refreshGrants();
    render();
    (listEl.querySelector('[data-action="test"]') || document.getElementById("add-empty")).focus();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && isStateChange(changes)) refresh();
});

await refresh();
if (location.hash === "#add" && state.webhooks.length === 0) openEditor();
