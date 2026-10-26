/**
 * Webhook list model. Pure functions over { webhooks, defaultWebhookId } so
 * every surface (options, popup, service worker) and the tests share one set
 * of rules. Storage I/O lives in lib/store.js.
 */
import { parseWebhookUrl } from "./protocol.js";

/** Fixed id so a migration that races itself (popup + worker) still converges. */
export const LEGACY_WEBHOOK_ID = "monica-legacy";
export const LEGACY_WEBHOOK_NAME = "Monica";
export const LEGACY_KEYS = ["webhookUrl", "webhookKey"];
export const NAME_MAX = 40;

export function normalizeName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

function sameName(a, b) {
  return normalizeName(a).toLocaleLowerCase() === normalizeName(b).toLocaleLowerCase();
}

function isWebhook(value) {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id !== "" &&
    typeof value.name === "string" &&
    typeof value.url === "string"
  );
}

export function normalizeState(raw) {
  const list = Array.isArray(raw?.webhooks) ? raw.webhooks.filter(isWebhook) : [];
  const webhooks = list.map((w) => ({
    id: w.id,
    name: w.name,
    url: w.url,
    key: String(w.key ?? ""),
    createdAt: Number(w.createdAt) || 0,
  }));
  const wanted = String(raw?.defaultWebhookId ?? "");
  const defaultWebhookId = webhooks.some((w) => w.id === wanted) ? wanted : webhooks[0]?.id ?? "";
  return { webhooks, defaultWebhookId };
}

export function findWebhook(state, id) {
  return state.webhooks.find((w) => w.id === id) ?? null;
}

export function resolveDefault(state) {
  return findWebhook(state, state.defaultWebhookId) ?? state.webhooks[0] ?? null;
}

/** Popup targets: the remembered ids that still exist, else the default webhook. */
export function resolveTargets(state, rememberedIds) {
  const wanted = Array.isArray(rememberedIds) ? rememberedIds : [];
  const ids = [...new Set(wanted)].filter((id) => findWebhook(state, id));
  if (ids.length) return ids;
  const fallback = resolveDefault(state);
  return fallback ? [fallback.id] : [];
}

export function webhookOrigin(webhook) {
  const parsed = parseWebhookUrl(webhook?.url);
  return parsed.ok ? parsed.originPattern : null;
}

/**
 * Validate form input against the current list. `id` marks an edit: the
 * webhook may keep its own name, and a blank key keeps the stored key so the
 * options page never has to put the key back into the DOM.
 */
export function validateWebhook(input, webhooks, { id } = {}) {
  const errors = {};
  const name = normalizeName(input?.name);
  const rawUrl = String(input?.url ?? "").trim();
  const existing = id ? webhooks.find((w) => w.id === id) : null;
  const key = String(input?.key ?? "").trim() || (existing ? existing.key : "");

  if (!name) errors.name = "请填写名称";
  else if (name.length > NAME_MAX) errors.name = `名称不超过 ${NAME_MAX} 个字符`;
  else if (webhooks.some((w) => w.id !== id && sameName(w.name, name))) errors.name = "已有同名的 webhook";

  if (!rawUrl) errors.url = "请填写 Webhook URL";
  else {
    const parsed = parseWebhookUrl(rawUrl);
    if (!parsed.ok) {
      errors.url = /http or https/.test(parsed.error) ? "只支持 http:// 或 https:// 地址" : "URL 格式不正确";
    }
  }

  if (!key) errors.key = "请填写 Bearer key";

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, url: rawUrl, key } : null };
}

export function addWebhook(state, input, { id, now }) {
  const check = validateWebhook(input, state.webhooks);
  if (!check.ok) return { ok: false, errors: check.errors, state };
  const webhook = { id, ...check.value, createdAt: now };
  const webhooks = [...state.webhooks, webhook];
  return {
    ok: true,
    webhook,
    state: { webhooks, defaultWebhookId: state.defaultWebhookId || id },
  };
}

export function updateWebhook(state, id, input) {
  const previous = findWebhook(state, id);
  if (!previous) return { ok: false, errors: { form: "这个 webhook 已被删除" }, state };
  const check = validateWebhook(input, state.webhooks, { id });
  if (!check.ok) return { ok: false, errors: check.errors, state };
  const webhook = { ...previous, ...check.value };
  return {
    ok: true,
    webhook,
    previous,
    state: { ...state, webhooks: state.webhooks.map((w) => (w.id === id ? webhook : w)) },
  };
}

export function removeWebhook(state, id) {
  const removed = findWebhook(state, id);
  if (!removed) return { state, removed: null };
  return { state: normalizeState({ ...state, webhooks: state.webhooks.filter((w) => w.id !== id) }), removed };
}

export function setDefaultWebhook(state, id) {
  if (!findWebhook(state, id) || state.defaultWebhookId === id) return state;
  return { ...state, defaultWebhookId: id };
}

/** Host-permission patterns used by `before` but no longer by any webhook in `after`. */
export function originsToRevoke(before, after) {
  const still = new Set(after.map(webhookOrigin).filter(Boolean));
  return [...new Set(before.map(webhookOrigin).filter(Boolean))].filter((o) => !still.has(o));
}

/**
 * Plan the v1 → v2 upgrade from a raw storage snapshot. Returns what to write
 * and which legacy keys to drop; running it again on the result is a no-op.
 * A present `webhooks` array always wins so a migrated profile is never reset.
 */
export function migrateStorage(data, { now }) {
  const remove = LEGACY_KEYS.filter((k) => k in (data ?? {}));
  if (Array.isArray(data?.webhooks)) return { set: null, remove };
  const url = String(data?.webhookUrl ?? "").trim();
  if (!url) return { set: null, remove };
  const webhook = {
    id: LEGACY_WEBHOOK_ID,
    name: LEGACY_WEBHOOK_NAME,
    url,
    key: String(data?.webhookKey ?? "").trim(),
    createdAt: now,
  };
  return { set: { webhooks: [webhook], defaultWebhookId: webhook.id }, remove };
}
