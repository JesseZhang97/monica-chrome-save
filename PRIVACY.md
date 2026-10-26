# Save To Monica Privacy Policy

Effective date: October 17, 2026
Last updated: October 26, 2026 (version 2.0.0)

Save To Monica is a Chrome extension that sends the current tab's title, URL, optional selected text and notes to one or more webhooks that the user configures (for example, a personal Monica ingest endpoint).

## Data the extension uses

The extension uses the following data only when the user explicitly triggers a save (the popup's send button or Cmd/Ctrl+Enter, the "Save to Monica" / "Save to ▸ {name}" context menu, or the Alt+Shift+S shortcut that opens the popup):

- Page title and URL: read from the active tab to build the saved entry.
- Selected text: if text is selected on the page, it is read and included in the entry.
- Notes: any text the user types or edits in the popup before sending.
- Webhooks: for each webhook the user adds on the Options page, a name, the webhook URL and a Bearer key, used to authenticate the request to the user's own webhook.

## Data sharing

The content of a save (title, URL, selected text and notes) is sent only to the webhook(s) the user picks for that save, each with its own Bearer key. It is not sent anywhere else.

The extension does not collect, sell, or share user data with the developer or any third party. It does not use user data for advertising, credit decisions, or any purpose unrelated to saving pages to the user's webhooks. The extension contains no analytics, tracking, or telemetry.

## Data storage

Everything below is stored locally in the browser with `chrome.storage.local`. None of it is synced or uploaded, and it is removed when the extension is uninstalled.

- The webhook list (name, URL, Bearer key, creation time) and which webhook is the default.
- The webhook(s) last selected in the popup, so the popup can preselect them next time.
- The most recent failed context-menu save, so its content is not lost and can be resent from the popup: the content, the target webhook's id, the time of the failure, and the error type and HTTP status code. Only one such record is kept; it is deleted when it is resent successfully or discarded. It never contains the Bearer key or the webhook's response.

The Bearer key is never displayed again after it is saved, and the extension never shows or stores webhook response bodies. The developer does not operate a server for this extension and does not receive or store any user data.

## Contact

For privacy questions, open an issue at https://github.com/JesseZhang97/monica-chrome-save/issues.
