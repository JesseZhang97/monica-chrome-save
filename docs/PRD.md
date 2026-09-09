# PRD — Monica Chrome Save (MV3)

## Goal
Desktop Chrome (macOS + Windows) capture client that posts into the **same Monica webhook** as the iOS Shortcut「Save to Feishu」/ routine「内容入库」. One protocol, multiple triggers.

## Non-goals
- Do not invent a second ingest API or Feishu write path in the extension.
- Do not store or log the webhook key in git, screenshots, or issue bodies.
- Do not build Firefox/Safari ports in v1.
- Do not scrape page HTML in the extension for summarization (Monica does content digestion server-side when links are in `content`).

## Protocol (SSOT — match phone Shortcut)
- `POST` to user-configured webhook URL (Monica routine webhook).
- Header: `Authorization: Bearer <webhook_key>` (key from options UI / chrome.storage.sync; never hardcoded).
- Body JSON: `{ "content": "<string>" }` only.
- `content` should include enough for Monica to act: at minimum page URL; preferably title + URL; optionally selected text.

### Recommended `content` template
```
标题: {title}
链接: {url}

{selection_or_empty}
```
If selection empty, still send title+url.

## Product — v1 Chrome Extension (Manifest V3)
### Must
1. Toolbar button: save **current tab** title + URL.
2. Context menu: "Save to Monica" on page / link / selection.
3. Options page: webhook URL + Bearer key + test button (shows HTTP status only, never echo key).
4. Keyboard shortcut (configurable): default `Alt+Shift+S` save current tab.
5. Toast / badge feedback: success / HTTP error / missing config.
6. Works on macOS and Windows Chrome (and Edge Chromium if MV3-compatible; primary target Chrome).

### Should
7. Optional: include selected text when present.
8. Optional: right-click link → save that href (not only active tab).
9. README: load unpacked, set options, privacy note (key stays local).

### Could (later)
10. Upsert into Feishu「收藏库」bitable as well as Wiki 外源 (requires Monica routine change — out of extension scope).
11. Batch save open tabs.
12. Sync settings via chrome.storage.sync.

## Acceptance criteria
- [ ] MV3 extension loads unpacked in Chrome without errors.
- [ ] With valid URL+key, one click saves active tab; Monica routine receives `{content}` and can process (manual e2e with Jesse's webhook).
- [ ] Missing config blocks send with clear message.
- [ ] No secrets in repository.
- [ ] README covers Mac + Windows install (same steps).
- [ ] Minimal permissions: prefer `activeTab`, `storage`, `contextMenus`; host permission only for the configured webhook origin if required (document approach).

## Tech constraints
- Manifest V3 service worker; no persistent background page.
- Prefer `fetch` from extension context (not page CSP).
- TypeScript optional; vanilla JS OK if faster to ship.
- Package name / repo: `monica-chrome-save`.

## Repo deliverables
- `manifest.json`, background SW, options UI, icons (simple placeholder OK).
- `README.md` (install + config).
- `docs/PRD.md` (this file).
- `.gitignore` (no `.env`, no key files).

## Out of scope for Richard unless asked
- Publishing to Chrome Web Store.
- Changing Monica routine / Feishu Wiki schema.
- iOS Shortcut edits.

## Build instruction for implementer
Use **Grok 4.6 high** (Grok build / highest reasoning) for implementation. Ship on a feature branch; do **not** open a PR until asked. Do not merge.
