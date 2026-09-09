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

/**
 * POST { content } with Authorization: Bearer <key>.
 * Returns HTTP status for UI; never includes the key or response body.
 */
export async function postToMonica({ webhookUrl, webhookKey, content }) {
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed.ok) {
    return { ok: false, kind: "config", status: 0, message: parsed.error };
  }
  const key = String(webhookKey ?? "").trim();
  if (!key) {
    return { ok: false, kind: "config", status: 0, message: "Bearer key is required" };
  }

  try {
    const res = await fetch(parsed.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: String(content ?? "") }),
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
    return {
      ok: false,
      kind: "network",
      status: 0,
      message: "Could not reach webhook",
    };
  }
}
