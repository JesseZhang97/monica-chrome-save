import { getConfig, setConfig } from "./lib/config.js";
import { buildContent, isConfigured, parseWebhookUrl, postToMonica } from "./lib/protocol.js";

const webhookUrlEl = document.getElementById("webhookUrl");
const webhookKeyEl = document.getElementById("webhookKey");
const statusEl = document.getElementById("status");
const formEl = document.getElementById("form");
const testEl = document.getElementById("test");

function setStatus(text, kind) {
  statusEl.textContent = text;
  if (kind) statusEl.dataset.kind = kind;
  else delete statusEl.dataset.kind;
}

async function requestOrigin(webhookUrl) {
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed.ok) return { granted: false, error: parsed.error };
  const granted = await chrome.permissions.request({ origins: [parsed.originPattern] });
  return { granted };
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const webhookUrl = webhookUrlEl.value.trim();
  const webhookKey = webhookKeyEl.value.trim();
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed.ok) {
    setStatus(parsed.error, "err");
    return;
  }
  if (!webhookKey) {
    setStatus("Bearer key is required", "err");
    return;
  }

  const perm = await requestOrigin(webhookUrl);
  await setConfig({ webhookUrl, webhookKey });
  if (!perm.granted) {
    setStatus(
      "Saved on this device, but host permission was not granted. Chrome will block the webhook until you allow it.",
      "err"
    );
    return;
  }
  setStatus("Saved", "ok");
});

testEl.addEventListener("click", async () => {
  const webhookUrl = webhookUrlEl.value.trim();
  const webhookKey = webhookKeyEl.value.trim();
  if (!isConfigured({ webhookUrl, webhookKey })) {
    setStatus("Missing config — enter webhook URL and Bearer key", "err");
    return;
  }
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed.ok) {
    setStatus(parsed.error, "err");
    return;
  }
  const perm = await requestOrigin(webhookUrl);
  if (!perm.granted) {
    setStatus("Host permission not granted", "err");
    return;
  }

  const content = buildContent({
    title: "Monica Chrome Save — connection test",
    url: "https://example.com/",
    selection: "",
  });
  const result = await postToMonica({ webhookUrl, webhookKey, content });
  if (result.status) {
    setStatus(`HTTP ${result.status}`, result.ok ? "ok" : "err");
  } else {
    setStatus(result.message, "err");
  }
});

const cfg = await getConfig();
webhookUrlEl.value = cfg.webhookUrl;
webhookKeyEl.value = cfg.webhookKey;
