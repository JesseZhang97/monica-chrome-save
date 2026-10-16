# Monica Chrome Save Privacy Policy

Effective date: October 17, 2026

Monica Chrome Save is a Chrome extension that sends the current tab's title, URL, optional selected text and notes to a webhook that the user configures (for example, a personal Monica ingest endpoint).

## Data the extension uses

The extension uses the following data only when the user explicitly triggers a save (popup Send button, the "Save to Monica" context menu, or the Alt+Shift+S shortcut):

- Page title and URL: read from the active tab to build the saved entry.
- Selected text: if text is selected on the page, it is read and included in the entry.
- Notes: any text the user types or edits in the popup before sending.
- Webhook URL and Bearer key: entered by the user on the Options page and used to authenticate the request to the user's own webhook.

## Data sharing

The content of a save (title, URL, selected text and notes) is sent only to the webhook URL that the user configured, using the user's own Bearer key. It is not sent anywhere else.

The extension does not collect, sell, or share user data with the developer or any third party. It does not use user data for advertising, credit decisions, or any purpose unrelated to saving pages to the user's webhook. The extension contains no analytics, tracking, or telemetry.

## Data storage

The webhook URL and Bearer key are stored locally in the browser with `chrome.storage.local` and are not synced or uploaded. The developer does not operate a server for this extension and does not receive or store any user data.

## Contact

For privacy questions, open an issue at https://github.com/JesseZhang97/monica-chrome-save/issues.
