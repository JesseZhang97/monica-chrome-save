import { buildContent, isConfigured, parseWebhookUrl, postToMonica } from "./lib/protocol.js";
import { getConfig } from "./lib/config.js";

const MENU_ID = "save-to-monica";
const BADGE_CLEAR_MS = 3200;

let badgeTimer = 0;

function setBadge(kind, text) {
  const colors = {
    ok: "#0F766E",
    err: "#B91C1C",
    cfg: "#B45309",
  };
  chrome.action.setBadgeBackgroundColor({ color: colors[kind] || colors.err });
  chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" });
  chrome.action.setBadgeText({ text: String(text || "").slice(0, 4) });
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    badgeTimer = 0;
  }, BADGE_CLEAR_MS);
}

function showToast(tabId, message, kind) {
  if (tabId == null) return;
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: (msg, tone) => {
        const id = "__monica_chrome_save_toast";
        document.getElementById(id)?.remove();
        const el = document.createElement("div");
        el.id = id;
        el.setAttribute("role", "status");
        el.textContent = msg;
        const bg = tone === "ok" ? "#0F766E" : tone === "cfg" ? "#B45309" : "#B91C1C";
        el.style.cssText = [
          "position:fixed",
          "z-index:2147483647",
          "top:16px",
          "right:16px",
          "max-width:min(360px, calc(100vw - 32px))",
          "padding:10px 14px",
          "border-radius:10px",
          "font:13px/1.4 system-ui,sans-serif",
          "color:#F8FAFC",
          `background:${bg}`,
          "box-shadow:0 8px 24px rgba(0,0,0,.28)",
          "pointer-events:none",
        ].join(";");
        (document.body || document.documentElement).appendChild(el);
        setTimeout(() => el.remove(), 2800);
      },
      args: [message, kind],
    })
    .catch(() => {
      /* Restricted pages (chrome://, Web Store, etc.) cannot be scripted; badge still shows. */
    });
}

function notify(tabId, result) {
  let kind = "err";
  let badge = "ERR";
  let toast = result.message;

  if (result.ok) {
    kind = "ok";
    badge = "OK";
    toast = "Saved to Monica";
  } else if (result.kind === "config" || result.kind === "permission") {
    kind = "cfg";
    badge = result.kind === "permission" ? "PERM" : "CFG";
  } else if (result.kind === "http" && result.status) {
    badge = String(result.status);
    toast = `HTTP ${result.status}`;
  }

  setBadge(kind, badge);
  showToast(tabId, toast, kind);
}

async function hasOriginPermission(webhookUrl) {
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed.ok) return false;
  return chrome.permissions.contains({ origins: [parsed.originPattern] });
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

async function sendContent(tab, content) {
  const config = await getConfig();
  if (!isConfigured(config)) {
    const result = {
      ok: false,
      kind: "config",
      status: 0,
      message: "Missing config — set webhook URL and Bearer key in Options",
    };
    notify(tab?.id, result);
    chrome.runtime.openOptionsPage().catch(() => {});
    return result;
  }

  const allowed = await hasOriginPermission(config.webhookUrl);
  if (!allowed) {
    const result = {
      ok: false,
      kind: "permission",
      status: 0,
      message: "Host permission missing — open Options, save, and allow access",
    };
    notify(tab?.id, result);
    chrome.runtime.openOptionsPage().catch(() => {});
    return result;
  }

  const body = String(content ?? "").trim();
  if (!body) {
    const result = {
      ok: false,
      kind: "config",
      status: 0,
      message: "Content is empty",
    };
    notify(tab?.id, result);
    return result;
  }

  const result = await postToMonica({
    webhookUrl: config.webhookUrl,
    webhookKey: config.webhookKey,
    content: body,
  });
  notify(tab?.id, result);
  return result;
}

async function savePayload(tab, { url, title, selection }) {
  const href = String(url || "").trim();
  if (!href) {
    notify(tab?.id, {
      ok: false,
      kind: "config",
      status: 0,
      message: "Cannot read this tab URL (restricted page)",
    });
    return;
  }

  const content = buildContent({
    title: title || tab?.title || "",
    url: href,
    selection: selection || "",
  });
  await sendContent(tab, content);
}

async function createMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save to Monica",
    contexts: ["page", "link", "selection"],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type !== "save-content") return;
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await sendContent(tab, message.content);
    sendResponse(result);
  })().catch(() => {
    sendResponse({
      ok: false,
      kind: "error",
      status: 0,
      message: "Save failed",
    });
  });
  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const linkUrl = info.linkUrl || "";
  const pageUrl = info.pageUrl || tab?.url || "";
  const url = linkUrl || pageUrl;
  let selection = String(info.selectionText || "").trim();
  if (!selection && !linkUrl) {
    selection = await getSelectionText(tab?.id);
  }
  await savePayload(tab, {
    url,
    title: tab?.title || "",
    selection,
  });
});
