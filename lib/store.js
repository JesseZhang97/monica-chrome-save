/**
 * chrome.storage.local I/O for the webhook list. Everything stays on this
 * profile; nothing here is synced or logged. `storage` is injectable so the
 * node tests can run the real migration path against an in-memory area.
 */
import { LEGACY_KEYS, migrateStorage, normalizeState } from "./webhooks.js";

const STATE_KEYS = ["webhooks", "defaultWebhookId"];

function local() {
  return chrome.storage.local;
}

/** Load the list, upgrading v1 settings on first read. Safe to call from any surface. */
export async function loadState(storage = local(), { now = Date.now() } = {}) {
  const data = await storage.get([...STATE_KEYS, ...LEGACY_KEYS]);
  const plan = migrateStorage(data, { now });
  if (plan.set) {
    // Write the new shape before dropping the old keys so a crash in between loses nothing.
    await storage.set(plan.set);
    Object.assign(data, plan.set);
  }
  if (plan.remove.length) await storage.remove(plan.remove);
  return normalizeState(data);
}

export async function saveState(state, storage = local()) {
  const { webhooks, defaultWebhookId } = normalizeState(state);
  await storage.set({ webhooks, defaultWebhookId });
}

export function isStateChange(changes) {
  return STATE_KEYS.some((k) => k in changes);
}
