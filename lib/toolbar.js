/**
 * Toolbar badge + tooltip feedback. The tooltip (chrome.action.setTitle) is
 * the only readable channel on pages Chrome forbids scripting on (chrome://,
 * the Web Store), so failures stay on the badge and tooltip until the popup
 * is opened and shows the saved failure.
 */
const BADGE_COLORS = { ok: "#0F766E", warn: "#B45309", err: "#B91C1C" };
const SUCCESS_CLEAR_MS = 3200;

let clearTimer = 0;

function defaultTitle() {
  return chrome.runtime.getManifest().action?.default_title ?? "";
}

export async function showToolbarResult({ tone, badge, title }) {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = 0;
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[tone] ?? BADGE_COLORS.err }),
    chrome.action.setBadgeTextColor({ color: "#FFFFFF" }),
    chrome.action.setBadgeText({ text: String(badge).slice(0, 4) }),
    chrome.action.setTitle({ title: `${defaultTitle()}\n${title}` }),
  ]);
  if (tone === "ok") clearTimer = setTimeout(clearToolbarAlert, SUCCESS_CLEAR_MS);
}

export async function clearToolbarAlert() {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = 0;
  await Promise.all([chrome.action.setBadgeText({ text: "" }), chrome.action.setTitle({ title: defaultTitle() })]);
}
