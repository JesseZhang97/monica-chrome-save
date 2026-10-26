/**
 * Send content to one stored webhook. Shared by the popup (via a runtime
 * message) and the context menu so both go through the same checks. The
 * result carries kind/status (+ the origin pattern when host access is
 * missing) and never the key or the response body.
 */
import { postToMonica } from "./protocol.js";
import { loadState } from "./store.js";
import { findWebhook, webhookOrigin } from "./webhooks.js";

export async function deliver(webhookId, content) {
  const hook = findWebhook(await loadState(), webhookId);
  if (!hook) return { ok: false, kind: "missing", status: 0, message: "Webhook not found", name: "" };
  const base = { name: hook.name };

  const body = String(content ?? "").trim();
  if (!body) return { ...base, ok: false, kind: "empty", status: 0, message: "Content is empty" };

  const origin = webhookOrigin(hook);
  if (!origin || !hook.key) return { ...base, ok: false, kind: "config", status: 0, message: "Webhook is incomplete" };
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    return { ...base, ok: false, kind: "permission", status: 0, message: "Host permission missing", origin };
  }

  const result = await postToMonica({ webhookUrl: hook.url, webhookKey: hook.key, content: body });
  return { ...base, ...result };
}
