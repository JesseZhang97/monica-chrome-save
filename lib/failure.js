/**
 * The most recent failed save, kept so the content is not lost and the popup
 * can resend it. Exactly one record; never the key or a response body.
 */
const KEY = "lastFailure";

function local() {
  return chrome.storage.local;
}

export function buildFailureRecord({ content, webhookIds, result, now }) {
  return {
    content: String(content ?? ""),
    webhookIds: [...webhookIds],
    failedAt: now,
    error: { kind: String(result?.kind ?? "error"), status: Number(result?.status) || 0 },
  };
}

function isRecord(value) {
  return (
    value != null &&
    typeof value.content === "string" &&
    value.content.trim() !== "" &&
    Array.isArray(value.webhookIds) &&
    typeof value.error?.kind === "string"
  );
}

export async function loadLastFailure(storage = local()) {
  const { [KEY]: record } = await storage.get([KEY]);
  return isRecord(record) ? record : null;
}

export async function saveLastFailure(record, storage = local()) {
  await storage.set({ [KEY]: record });
}

export async function clearLastFailure(storage = local()) {
  await storage.remove([KEY]);
}

export function isFailureChange(changes) {
  return KEY in changes;
}
