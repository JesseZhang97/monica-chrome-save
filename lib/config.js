import { loadState, saveState } from "./store.js";
import { LEGACY_WEBHOOK_NAME, addWebhook, resolveDefault, updateWebhook } from "./webhooks.js";

/** Single-webhook view of the list for the v1 surfaces: reads and edits the default webhook. */
export async function getConfig() {
  const hook = resolveDefault(await loadState());
  return {
    webhookUrl: String(hook?.url ?? "").trim(),
    webhookKey: String(hook?.key ?? "").trim(),
  };
}

export async function setConfig({ webhookUrl, webhookKey }) {
  const state = await loadState();
  const current = resolveDefault(state);
  const input = { name: current?.name ?? LEGACY_WEBHOOK_NAME, url: webhookUrl, key: webhookKey };
  const result = current
    ? updateWebhook(state, current.id, input)
    : addWebhook(state, input, { id: crypto.randomUUID(), now: Date.now() });
  if (!result.ok) throw new Error(Object.values(result.errors)[0]);
  await saveState(result.state);
}
