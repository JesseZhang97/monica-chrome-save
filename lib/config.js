const KEYS = {
  webhookUrl: "webhookUrl",
  webhookKey: "webhookKey",
};

/** Settings stay in chrome.storage.local on this profile — never written to disk in the repo. */
export async function getConfig() {
  const data = await chrome.storage.local.get([KEYS.webhookUrl, KEYS.webhookKey]);
  return {
    webhookUrl: String(data[KEYS.webhookUrl] ?? "").trim(),
    webhookKey: String(data[KEYS.webhookKey] ?? "").trim(),
  };
}

export async function setConfig({ webhookUrl, webhookKey }) {
  await chrome.storage.local.set({
    [KEYS.webhookUrl]: String(webhookUrl ?? "").trim(),
    [KEYS.webhookKey]: String(webhookKey ?? "").trim(),
  });
}
