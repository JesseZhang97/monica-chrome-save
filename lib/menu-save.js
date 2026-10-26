/**
 * Context-menu save: build content from the click, send to the chosen
 * webhook, then report through badge + tooltip and (where Chrome allows
 * scripting) an in-page toast. Failed content is kept as the last failure so
 * the popup can resend it.
 */
import { deliver } from "./deliver.js";
import { buildFailureRecord, saveLastFailure } from "./failure.js";
import { describeResult, headline } from "./feedback.js";
import { menuSpec, webhookIdFromMenu } from "./menus.js";
import { buildContent } from "./protocol.js";
import { loadState } from "./store.js";
import { showToolbarResult } from "./toolbar.js";

const TOAST_COLORS = { ok: "#0F766E", warn: "#A16207", err: "#B91C1C" };

let rebuilding = Promise.resolve();

/** Rebuild the menu from storage. Serialized so overlapping rebuilds cannot collide on ids. */
export function rebuildMenus() {
  rebuilding = rebuilding
    .then(async () => {
      const spec = menuSpec(await loadState());
      await chrome.contextMenus.removeAll();
      for (const item of spec) {
        await new Promise((resolve) => {
          chrome.contextMenus.create(item, () => {
            if (chrome.runtime.lastError) console.error("Monica Chrome Save: menu item", chrome.runtime.lastError.message);
            resolve();
          });
        });
      }
    })
    .catch((error) => console.error("Monica Chrome Save: menu rebuild failed", error));
  return rebuilding;
}

async function showToast(tabId, lines, tone) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (text, bg, ms) => {
        const id = "__monica_chrome_save_toast";
        document.getElementById(id)?.remove();
        const el = document.createElement("div");
        el.id = id;
        el.setAttribute("role", "status");
        el.textContent = text;
        el.style.cssText = [
          "position:fixed",
          "z-index:2147483647",
          "top:16px",
          "right:16px",
          "max-width:min(360px, calc(100vw - 32px))",
          "padding:10px 14px",
          "border-radius:10px",
          "font:13px/1.5 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
          "white-space:pre-line",
          "color:#F8FAFC",
          `background:${bg}`,
          "box-shadow:0 8px 24px rgba(0,0,0,.28)",
          "pointer-events:none",
        ].join(";");
        (document.body || document.documentElement).appendChild(el);
        setTimeout(() => el.remove(), ms);
      },
      args: [lines.join("\n"), TOAST_COLORS[tone] ?? TOAST_COLORS.err, tone === "ok" ? 2800 : 6000],
    });
  } catch {
    /* Chrome forbids scripting here (chrome://, Web Store, PDF viewer…); badge + tooltip still report. */
  }
}

async function report(tab, result, name, { kept }) {
  const view = describeResult(result, { interactive: false });
  const lines = [headline(result, name, { interactive: false })];
  if (kept) lines.push(result.kind === "permission" ? "内容已保留,打开扩展可授权并重发" : "内容已保留,打开扩展可重发");
  await showToast(tab?.id, lines, view.tone);
  await showToolbarResult({ tone: view.tone, badge: view.badge, title: lines.join("\n") });
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

export async function saveFromMenu(info, tab) {
  const webhookId = webhookIdFromMenu(info.menuItemId);
  if (webhookId == null) return null;

  if (webhookId === "") {
    const result = { ok: false, kind: "config", status: 0 };
    await report(tab, result, "Monica", { kept: false });
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#add") });
    return result;
  }

  const hook = (await loadState()).webhooks.find((w) => w.id === webhookId);
  const name = hook?.name ?? "Monica";
  const linkUrl = info.linkUrl || "";
  const url = String(linkUrl || info.pageUrl || tab?.url || "").trim();
  if (!url) {
    const result = { ok: false, kind: "unreadable", status: 0 };
    await report(tab, result, name, { kept: false });
    return result;
  }

  let selection = String(info.selectionText || "").trim();
  if (!selection && !linkUrl) selection = await getSelectionText(tab?.id);
  const content = buildContent({ title: tab?.title || "", url, selection });

  const result = await deliver(webhookId, content);
  if (!result.ok) {
    // Persist before any best-effort UI so the content survives even if feedback fails.
    await saveLastFailure(buildFailureRecord({ content, webhookIds: [webhookId], result, now: Date.now() }));
  }
  await report(tab, result, result.name || name, { kept: !result.ok });
  return result;
}
