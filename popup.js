import { describeResult } from "./lib/feedback.js";
import { buildFailureRecord, clearLastFailure, loadLastFailure, saveLastFailure } from "./lib/failure.js";
import { buildContent } from "./lib/protocol.js";
import { loadPopupTargets, loadState, savePopupTargets } from "./lib/store.js";
import { clearToolbarAlert } from "./lib/toolbar.js";
import { findWebhook, resolveTargets, webhookOrigin } from "./lib/webhooks.js";

const CLOSE_AFTER_MS = 900;
const TEXTAREA_MAX_PX = 300;

const $ = (id) => document.getElementById(id);
const formEl = $("form");
const contentEl = $("content");
const sendEl = $("send");
const sendLabelEl = $("send-label");
const statusEl = $("status");
const resultsEl = $("results");
const pickerEl = $("picker");
const pickerListEl = $("picker-list");

let state = { webhooks: [], defaultWebhookId: "" };
let targets = [];
/**
 * Main form state machine:
 *   idle -> sending -> done (all ok, popup closes)
 *                   -> failed (content kept, primary button retries failed targets)
 */
let phase = "idle";
/** Targets of the current attempt and their results, rendered as rows. */
let batch = [];
const results = new Map();
/** Guards the main form and the "上次发送失败" retry against overlapping sends. */
let busy = false;
/** The stored failed save currently offered for resend, or null. */
let shownFailure = null;

function setStatus(el, text, kind) {
  el.textContent = text;
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

function nameOf(id) {
  return findWebhook(state, id)?.name ?? "已删除的 webhook";
}

function quoteNames(ids) {
  return ids.map((id) => `「${nameOf(id)}」`).join("、");
}

function sendTo(webhookId, content) {
  return chrome.runtime
    .sendMessage({ type: "send", webhookId, content })
    .then((result) => result ?? { ok: false, kind: "error", status: 0 })
    .catch(() => ({ ok: false, kind: "error", status: 0 }));
}

// ---- target picker -------------------------------------------------------

function renderTargets() {
  const single = state.webhooks.length === 1;
  $("target-single").hidden = !single;
  pickerEl.hidden = single;
  if (single) {
    $("target-name").textContent = state.webhooks[0].name;
  } else {
    const names = targets.map(nameOf);
    $("picker-label").textContent =
      names.length === 0 ? "未选择" : names.length <= 2 ? names.join("、") : `${names[0]} 等 ${names.length} 个`;
    pickerListEl.querySelectorAll("label").forEach((el) => el.remove());
    for (const hook of state.webhooks) {
      const label = document.createElement("label");
      label.className = "picker-option";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = hook.id;
      box.checked = targets.includes(hook.id);
      const text = document.createElement("span");
      text.textContent = hook.name;
      label.append(box, text);
      if (hook.id === state.defaultWebhookId) {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = "默认";
        label.append(pill);
      }
      pickerListEl.append(label);
    }
  }
  renderSendButton();
}

pickerListEl.addEventListener("change", () => {
  const checked = [...pickerListEl.querySelectorAll("input:checked")].map((el) => el.value);
  // Keep list order so multi-target sends always run in the same sequence.
  targets = state.webhooks.map((w) => w.id).filter((id) => checked.includes(id));
  savePopupTargets(targets);
  resetAttempt();
  if (targets.length === 0) setStatus(statusEl, "请至少选择一个目标", "warn");
  renderTargets();
});

pickerEl.querySelector("summary").addEventListener("click", (event) => {
  if (busy) event.preventDefault();
});

pickerEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pickerEl.open) {
    event.preventDefault();
    event.stopPropagation();
    pickerEl.open = false;
    pickerEl.querySelector("summary").focus();
  }
});

document.addEventListener("click", (event) => {
  if (pickerEl.open && !pickerEl.contains(event.target)) pickerEl.open = false;
});

// ---- main send -----------------------------------------------------------

function failedIds() {
  return batch.filter((id) => !results.get(id)?.ok);
}

function renderSendButton() {
  const sending = phase === "sending";
  sendEl.disabled = sending || phase === "done" || targets.length === 0;
  sendEl.setAttribute("aria-busy", String(sending));
  sendEl.dataset.state = phase;
  if (sending) sendLabelEl.textContent = "发送中…";
  else if (phase === "done") sendLabelEl.textContent = "已保存";
  else if (phase === "failed") {
    const n = failedIds().length;
    sendLabelEl.textContent = n > 1 ? `重试 ${n} 个失败项` : "重试";
  } else sendLabelEl.textContent = targets.length > 1 ? `发送到 ${targets.length} 个目标` : "发送";
}

function renderResults() {
  resultsEl.hidden = batch.length === 0;
  resultsEl.replaceChildren(
    ...batch.map((id) => {
      const result = results.get(id);
      const row = document.createElement("li");
      row.className = "result";
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = nameOf(id);
      const text = document.createElement("span");
      text.className = "result-text";
      if (!result) {
        row.dataset.state = phase === "sending" ? "sending" : "pending";
        text.textContent = row.dataset.state === "sending" ? "发送中…" : "等待中";
      } else {
        const view = describeResult(result);
        row.dataset.state = view.tone;
        text.textContent = view.text;
        if (view.action === "authorize" && result.origin) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "link";
          button.textContent = view.text;
          button.addEventListener("click", () => authorize(id, result.origin));
          text.replaceChildren(button);
        } else if (view.action === "configure") {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "link";
          button.textContent = "打开设置";
          button.addEventListener("click", () => chrome.runtime.openOptionsPage());
          text.append(" ", button);
        }
      }
      row.append(name, text);
      return row;
    })
  );
}

function resetAttempt() {
  phase = "idle";
  batch = [];
  results.clear();
  renderResults();
  setStatus(statusEl, "");
}

async function runSend(ids) {
  if (busy || ids.length === 0) return;
  const content = contentEl.value;
  if (!content.trim()) {
    setStatus(statusEl, "内容为空", "err");
    contentEl.focus();
    return;
  }
  busy = true;
  phase = "sending";
  if (!ids.every((id) => batch.includes(id))) batch = [...ids];
  for (const id of ids) results.delete(id);
  contentEl.readOnly = true;
  pickerEl.querySelector("summary").setAttribute("aria-disabled", "true");
  pickerEl.open = false;
  setStatus(statusEl, ids.length > 1 ? `正在发送到 ${ids.length} 个目标…` : "正在发送…");
  renderSendButton();

  // One at a time so each row reports its own outcome as it lands.
  for (const id of ids) {
    renderResults();
    results.set(id, await sendTo(id, content));
  }

  busy = false;
  contentEl.readOnly = false;
  pickerEl.querySelector("summary").removeAttribute("aria-disabled");
  const failed = failedIds();
  if (failed.length === 0) {
    phase = "done";
    renderResults();
    setStatus(statusEl, `已保存到${quoteNames(batch)}`, "ok");
    renderSendButton();
    setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return;
  }
  phase = "failed";
  renderResults();
  setStatus(
    statusEl,
    batch.length > 1 ? `${failed.length} 个目标发送失败,内容已保留,可重试` : "发送失败,内容已保留,可重试",
    "err"
  );
  renderSendButton();
  sendEl.focus();
}

async function authorize(id, origin) {
  // Must be called straight from the click so Chrome treats it as a user gesture.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [origin] });
  } catch (error) {
    console.warn("Monica Chrome Save: permission request failed", error);
  }
  if (granted) await runSend([id]);
  else setStatus(statusEl, "未获得授权,Chrome 会拦截发往该域名的请求", "warn");
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  runSend(phase === "failed" ? failedIds() : targets);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !formEl.hidden) {
    event.preventDefault();
    if (!sendEl.disabled) formEl.requestSubmit();
  }
});

function autosize() {
  contentEl.style.height = "auto";
  contentEl.style.height = `${Math.min(contentEl.scrollHeight + 2, TEXTAREA_MAX_PX)}px`;
}
contentEl.addEventListener("input", autosize);

// ---- last failed save ----------------------------------------------------

function formatTime(ms) {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${time}`;
}

function renderRecover(record) {
  shownFailure = record;
  const box = $("recover");
  box.hidden = !record;
  if (!record) return;
  const reason = describeResult({ ok: false, ...record.error }, { interactive: false }).text;
  $("recover-text").textContent = `发往${quoteNames(record.webhookIds)} · ${formatTime(record.failedAt)} · ${reason}`;
  $("recover-snippet").textContent = record.content.split("\n").find((line) => line.trim()) ?? "";
}

async function retryLastFailure() {
  if (busy || !shownFailure) return;
  const record = shownFailure;
  const ids = record.webhookIds.filter((id) => findWebhook(state, id));
  const statusBox = $("recover-status");
  if (record.error.kind === "permission" && ids.length) {
    // Ask before any other await so the click still counts as a user gesture.
    const origins = [...new Set(ids.map((id) => webhookOrigin(findWebhook(state, id))).filter(Boolean))];
    try {
      await chrome.permissions.request({ origins });
    } catch (error) {
      console.warn("Monica Chrome Save: permission request failed", error);
    }
  }
  if (ids.length === 0) {
    contentEl.value = record.content;
    autosize();
    await clearLastFailure();
    renderRecover(null);
    setStatus(statusEl, "原目标已不存在,内容已放回输入框", "warn");
    contentEl.focus();
    return;
  }
  busy = true;
  $("recover-retry").disabled = true;
  $("recover-discard").disabled = true;
  setStatus(statusBox, "正在重发…");
  const failed = [];
  let lastError = null;
  for (const id of ids) {
    const result = await sendTo(id, record.content);
    if (!result.ok) {
      failed.push(id);
      lastError = result;
    }
  }
  busy = false;
  if (failed.length === 0) {
    await clearLastFailure();
    shownFailure = null;
    setStatus(statusBox, `已重发到${quoteNames(ids)}`, "ok");
    setTimeout(() => {
      renderRecover(null);
      contentEl.focus();
    }, 1200);
    return;
  }
  const next = buildFailureRecord({ content: record.content, webhookIds: failed, result: lastError, now: Date.now() });
  await saveLastFailure(next);
  renderRecover(next);
  $("recover-retry").disabled = false;
  $("recover-discard").disabled = false;
  setStatus(statusBox, `重发失败:${describeResult(lastError, { interactive: false }).text}`, "err");
  $("recover-retry").focus();
}

$("recover-retry").addEventListener("click", retryLastFailure);
$("recover-discard").addEventListener("click", async () => {
  await clearLastFailure();
  renderRecover(null);
  contentEl.focus();
});

// ---- startup -------------------------------------------------------------

async function getSelectionText(tabId) {
  if (tabId == null) return "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection && window.getSelection().toString()) || "",
    });
    return String(results?.[0]?.result ?? "").trim();
  } catch {
    return "";
  }
}

async function prefill() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const selection = await getSelectionText(tab?.id);
  contentEl.value = buildContent({ title: tab?.title || "", url: tab?.url || "", selection });
  autosize();
  contentEl.focus();
  const end = contentEl.value.length;
  contentEl.setSelectionRange(end, end);
}

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("setup-open").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html#add") });
  window.close();
});
$("shortcut").textContent = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform) ? "⌘ Enter" : "Ctrl Enter";

// The badge/tooltip pointed the user here; the popup now shows the details.
clearToolbarAlert();
state = await loadState();
targets = resolveTargets(state, await loadPopupTargets());
renderRecover(await loadLastFailure());
if (state.webhooks.length === 0) {
  $("setup").hidden = false;
  $("setup-open").focus();
} else {
  formEl.hidden = false;
  renderTargets();
  await prefill();
}
