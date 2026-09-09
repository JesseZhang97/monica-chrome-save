# Monica Chrome Save

Chrome Manifest V3 extension that saves the current tab (title + URL, optional selection) to **the same Monica ingest webhook** as the iOS Shortcut.

Protocol (do not invent another):

- `POST` to the user-configured webhook URL
- Header: `Authorization: Bearer <webhook_key>`
- Body JSON **only**: `{ "content": "..." }`

```
标题: {title}
链接: {url}

{selection_or_empty}
```

If nothing is selected, title + URL are still sent.

This extension does **not** write to Feishu and does **not** change Monica routines.

## Load unpacked (macOS and Windows)

Chrome steps are the same on both operating systems; only the folder picker looks different.

1. Clone or download this repo and keep the folder together (`manifest.json` must be at the folder root you select).
2. Open Chrome (or Edge).
3. Go to `chrome://extensions` (Edge: `edge://extensions`).
4. Turn **Developer mode** on (top right).
5. Click **Load unpacked**.
6. Select this repository folder (the one that contains `manifest.json`).
   - **Mac:** Finder dialog — navigate to the clone, select the folder, Open.
   - **Windows:** Explorer dialog — navigate to the clone, select the folder, Select Folder.

The toolbar gets a Monica Chrome Save icon. Pin it from the puzzle-piece menu if it is hidden.

Reload the extension on `chrome://extensions` after you pull updates.

## Configure

1. On `chrome://extensions`, click **Details → Extension options**, or right-click the toolbar icon → **Options**.
2. Paste the Monica routine webhook URL.
3. Paste the Bearer key.
4. Click **Save**. Chrome will ask for permission to contact **that webhook origin** — allow it.
5. Optionally click **Test**. The page shows **HTTP status only** (for example `HTTP 200`). It never prints the key or the response body.

Until URL + key are saved, toolbar / shortcut / context-menu saves are blocked with a **CFG** badge, a toast, and the options page opens.

## How to save

| Trigger | What is sent |
| --- | --- |
| Toolbar icon | Current tab title + URL, plus selected text if the page allows it |
| `Alt+Shift+S` | Same as toolbar (Mac: Option+Shift+S) |
| Right-click page → **Save to Monica** | Page title + URL, plus selection if present |
| Right-click selected text → **Save to Monica** | Page title + URL + selection |
| Right-click a link → **Save to Monica** | Current page title + **that link’s href** (not only the tab URL), plus selection if present |

Change or confirm the shortcut at `chrome://extensions/shortcuts`. Chrome may ignore the default if another extension already claimed it.

## Privacy

- The Bearer key is stored in `chrome.storage.local` for **this browser profile only**.
- It is **not** written to git, screenshots in this repo, or any file on disk besides Chrome’s own extension storage.
- The key is sent only as the `Authorization` header to the webhook URL **you** configured.
- Options **Test** displays HTTP status only and never echoes the key.
- This extension does not scrape page HTML for summarization. Monica handles digestion when a link is in `content`.

## Permissions

Required (always):

| Permission | Why |
| --- | --- |
| `activeTab` | Read the tab you just invoked (toolbar, shortcut, or context menu). |
| `storage` | Save webhook URL + key in `chrome.storage.local`. |
| `contextMenus` | “Save to Monica” on page / link / selection. |
| `scripting` | MV3 needs this to read `window.getSelection()` and to draw a toast **on the tab you invoked**. It is not an always-on content script. |

Host access is **not** granted up front:

- Manifest uses `optional_host_permissions` for `https://*/*` and `http://*/*` so any Monica webhook origin can be requested later.
- On **Save** or **Test**, the options page calls `chrome.permissions.request` for **that URL’s origin only** (`https://host:port/*`).
- The service worker checks the grant before `fetch`. If you skip the prompt, saves fail with a clear **PERM** message instead of a silent network error.

No `<all_urls>` required host permission. No Feishu API permission.

## Troubleshooting

- **CFG / “Missing config”** — open Options and save both fields.
- **PERM** — open Options, click Save, and accept the origin permission.
- **HTTP 401 / 403** — key or webhook URL is wrong; Test shows the status only.
- **Could not reach webhook** — URL typo, offline, or mixed-content/http issues.
- **No toast on `chrome://` or the Web Store** — Chrome forbids scripting there; the toolbar badge still updates.
- **Shortcut does nothing** — set it under `chrome://extensions/shortcuts`.

## Development

Vanilla JS, no build step. Service worker: `background.js` (`"type": "module"`). Shared protocol: `lib/protocol.js`.

```bash
node --test tests/protocol.test.mjs
```

Do not commit `.pem`, `.crx`, `.env`, or key files (see `.gitignore`).
