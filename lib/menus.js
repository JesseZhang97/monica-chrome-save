/**
 * Context-menu layout derived from the webhook list. One webhook (or none)
 * keeps the flat "Save to Monica" item; several become "Save to ▸ {name}".
 */
const CONTEXTS = ["page", "link", "selection"];
const PARENT_ID = "save-to";
const PREFIX = "save:";

export function menuSpec(state) {
  const { webhooks, defaultWebhookId } = state;
  if (webhooks.length === 0) return [{ id: "save", title: "Save to Monica", contexts: CONTEXTS }];
  if (webhooks.length === 1) {
    return [{ id: PREFIX + webhooks[0].id, title: "Save to Monica", contexts: CONTEXTS }];
  }
  return [
    { id: PARENT_ID, title: "Save to", contexts: CONTEXTS },
    ...webhooks.map((hook) => ({
      id: PREFIX + hook.id,
      parentId: PARENT_ID,
      title: hook.id === defaultWebhookId ? `${hook.name}(默认)` : hook.name,
      contexts: CONTEXTS,
    })),
  ];
}

/** Webhook id for a clicked item, "" for the no-webhook item, null if it is not ours. */
export function webhookIdFromMenu(menuItemId) {
  if (menuItemId === "save") return "";
  if (typeof menuItemId === "string" && menuItemId.startsWith(PREFIX)) return menuItemId.slice(PREFIX.length);
  return null;
}
