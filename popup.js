import { getConfig } from "./lib/config.js";
import { buildContent, isConfigured } from "./lib/protocol.js";

const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const formEl = document.getElementById("form");
const sendEl = document.getElementById("send");
const optionsEl = document.getElementById("options");

function setStatus(text, kind) {
  statusEl.textContent = text;
  if (kind) statusEl.dataset.kind = kind;
  else delete statusEl.dataset.kind;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

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
  const tab = await getActiveTab();
  const selection = await getSelectionText(tab?.id);
  contentEl.value = buildContent({
    title: tab?.title || "",
    url: tab?.url || "",
    selection,
  });
  contentEl.focus();
  const end = contentEl.value.length;
  contentEl.setSelectionRange(end, end);

  const config = await getConfig();
  if (!isConfigured(config)) {
    setStatus("Missing config — set webhook URL and Bearer key in Options", "err");
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = contentEl.value.trim();
  if (!content) {
    setStatus("Content is empty", "err");
    contentEl.focus();
    return;
  }

  sendEl.disabled = true;
  setStatus("Sending…");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "save-content",
      content: contentEl.value,
    });
    if (!result) {
      setStatus("Save failed", "err");
      return;
    }
    if (result.ok) {
      setStatus("Saved to Monica", "ok");
      setTimeout(() => window.close(), 900);
      return;
    }
    setStatus(result.message || "Save failed", "err");
  } catch {
    setStatus("Save failed", "err");
  } finally {
    sendEl.disabled = false;
  }
});

optionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

await prefill();
