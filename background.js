import { deliver } from "./lib/deliver.js";
import { rebuildMenus, saveFromMenu } from "./lib/menu-save.js";
import { isStateChange, loadState } from "./lib/store.js";

chrome.runtime.onInstalled.addListener(() => {
  // Upgrade v1 settings first so the menu is built from the migrated list.
  loadState()
    .catch((error) => console.error("Monica Chrome Save: settings migration failed", error))
    .then(rebuildMenus);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && isStateChange(changes)) rebuildMenus();
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  saveFromMenu(info, tab).catch((error) => console.error("Monica Chrome Save: context-menu save failed", error));
});
