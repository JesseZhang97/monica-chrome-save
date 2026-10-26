import { buildContent } from "./lib/protocol.js";
import { deliver } from "./lib/deliver.js";
import { describeResult, headline } from "./lib/feedback.js";
import { loadState } from "./lib/store.js";
import { resolveDefault } from "./lib/webhooks.js";

const MENU_ID = "save-to-monica";
const BADGE_CLEAR_MS = 3200;

let badgeTimer = 0;

function setBadge(kind, text) {
  const colors = {
    ok: "#0F766E",
    err: "#B91C1C",
    warn: "#B45309",
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
        const bg = tone === "ok" ? "#0F766E" : tone === "warn" ? "#B45309" : "#B91C1C";
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

function notify(tabId, result, name) {
  const view = describeResult(result);
  setBadge(view.tone, view.badge);
  showToast(tabId, headline(result, name), view.tone);
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

async function saveFromMenu(tab, { url, title, selection }) {
  const hook = resolveDefault(await loadState());
  if (!hook) {
    notify(tab?.id, { ok: false, kind: "config", status: 0 }, "Monica");
    chrome.runtime.openOptionsPage().catch(() => {});
    return;
  }
  const href = String(url || "").trim();
  if (!href) {
    notify(tab?.id, { ok: false, kind: "unreadable", status: 0 }, hook.name);
    return;
  }
  const content = buildContent({ title: title || tab?.title || "", url: href, selection: selection || "" });
  const result = await deliver(hook.id, content);
  notify(tab?.id, result, hook.name);
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
  // Upgrade v1 settings right away instead of waiting for the first save.
  loadState().catch((error) => console.error("Monica Chrome Save: settings migration failed", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type !== "send") return;
  deliver(String(message.webhookId ?? ""), message.content)
    .then(sendResponse)
    .catch((error) => {
      console.error("Monica Chrome Save: send failed", error);
      sendResponse({ ok: false, kind: "error", status: 0, message: "Save failed" });
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
  await saveFromMenu(tab, {
    url,
    title: tab?.title || "",
    selection,
  });
});
