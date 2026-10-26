import { loadState } from "./store.js";
import { resolveDefault } from "./webhooks.js";

/** Single-webhook view of the list for the v1 surfaces: the default webhook's url/key. */
export async function getConfig() {
  const hook = resolveDefault(await loadState());
  return {
    webhookUrl: String(hook?.url ?? "").trim(),
    webhookKey: String(hook?.key ?? "").trim(),
  };
}
