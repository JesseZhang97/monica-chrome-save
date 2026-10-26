/** Shared ingest protocol. Keep this aligned with the iOS Shortcut (docs/PRD.md). */

export function buildContent({ title, url, selection } = {}) {
  const href = String(url ?? "").trim();
  const heading = String(title ?? "").trim() || href || "(untitled)";
  const quote = String(selection ?? "").trim();
  let content = `标题: ${heading}\n链接: ${href}`;
  if (quote) content += `\n\n${quote}`;
  return content;
}

export function parseWebhookUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "Webhook URL is required" };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Webhook URL is not valid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Webhook URL must be http or https" };
  }
  return {
    ok: true,
    url: parsed.href,
    originPattern: `${parsed.origin}/*`,
  };
}

export function isConfigured({ webhookUrl, webhookKey } = {}) {
  return Boolean(String(webhookUrl ?? "").trim() && String(webhookKey ?? "").trim());
}

export const REQUEST_TIMEOUT_MS = 15000;

/**
 * POST { content } with Authorization: Bearer <key>.
 * Returns HTTP status for UI; never includes the key or response body.
 * Gives up after `timeoutMs` so a hung webhook surfaces as a failure.
 */
export async function postToMonica({ webhookUrl, webhookKey, content, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed.ok) {
    return { ok: false, kind: "config", status: 0, message: parsed.error };
  }
  const key = String(webhookKey ?? "").trim();
  if (!key) {
    return { ok: false, kind: "config", status: 0, message: "Bearer key is required" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parsed.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: String(content ?? "") }),
      signal: controller.signal,
    });
    const status = res.status;
    if (res.ok) {
      return { ok: true, kind: "ok", status, message: `HTTP ${status}` };
    }
    return {
      ok: false,
      kind: "http",
      status,
      message: `HTTP ${status}`,
    };
  } catch {
    if (controller.signal.aborted) {
      return { ok: false, kind: "timeout", status: 0, message: "Request timed out" };
    }
    return {
      ok: false,
      kind: "network",
      status: 0,
      message: "Could not reach webhook",
    };
  } finally {
    clearTimeout(timer);
  }
}
