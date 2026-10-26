# PRD — Save To Monica (MV3)

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

## Product — v2.0 (multiple webhooks + feedback)
Decided with Jesse on 2026-10-26. Protocol, request body and Bearer header are unchanged; no new permissions.

### Webhooks
- Storage (`chrome.storage.local`): `webhooks: [{ id, name, url, key, createdAt }]` + `defaultWebhookId`.
- Name required and unique (case-insensitive, whitespace-normalized); URL http(s); key required.
- Options page is a list: add, edit (blank key keeps the stored key), delete with confirmation, set default, per-row Test (HTTP status only). Empty state guides the first add.
- Host permission requested per webhook origin on save/test; released on delete/re-point when no other webhook uses that origin.
- Upgrade: v1 `webhookUrl` / `webhookKey` migrate into a default webhook named "Monica" (fixed id, idempotent), legacy keys removed.

### Popup
- Target picker at the top: default preselected, last selection remembered; multiple targets allowed, sent one by one with a result row each.
- States: sending (spinner, disabled, no double submit) → success (✓ "已保存到「名称」", auto-close after 0.9 s) → failure (plain-language reason + HTTP code, content kept, Retry for failed targets only).
- Reasons: 401/403 密钥或地址不对; 404 地址不存在; 429 请求过多,稍后再试; 5xx Monica 服务端错误; timeout / network 无法连接; missing origin grant "未授权访问该域名,点此授权" (requests the origin, then retries). Never the key or response body.
- Requests time out after 15 s (`AbortController`).
- Cmd/Ctrl+Enter sends. Keyboard operable, visible focus. UI copy is Chinese.

### Context menu
- One webhook: "Save to Monica". Several: "Save to ▸ {名称}" (default marked). No "Save to all". Rebuilt whenever the list changes.
- Feedback: badge (OK / status code / ERR / PERM / CFG) + toolbar tooltip (`chrome.action.setTitle`) + in-page toast where scripting is allowed. On `chrome://` / Web Store pages only badge + tooltip (no `notifications` permission).
- A failed save is kept as the single "last failure" (content, webhook id, time, error kind/status; no key, no response body). The failure badge stays until the popup opens, which offers resend or discard. No send history.

### Brand
- See v2.1 below (replaces the 2.0 teal bookmark logo and light/dark themes).

## Product — v2.1 (retro postal look)
Decided with Jesse on 2026-10-26. Visual only: behavior, storage, protocol and permissions are unchanged.

- Style: simple retro mailbox / post office, bright and airy. Light theme only; no dark mode.
- Palette: pale sky ground, white and cream paper, mailbox red `#D23A2D` as the accent (primary buttons, logo, stamp marks), navy `#1F3A5F` ink, thin sky rules. No green anywhere.
- Status: success postal blue `#1F4E8C`, failure brick red `#B8281C`, warning burnt orange `#A64B06`, shared by popup, options, toolbar badge and in-page toast.
- Details: airmail stripe top edge, ruled letter paper, logo as a perforated stamp, outlined stamp tag for the default webhook, dashed tear lines; small radii, clear borders; system fonts only.
- Logo: red mailbox on a light sky tile with a white letter entering the navy slot (the page is posted to the agent); no text, readable at 16 px. `icons/logo.svg` is the source; `scripts/generate-icons.py` renders the PNGs and a 1024 px master.

## Acceptance criteria
- [ ] MV3 extension loads unpacked in Chrome without errors.
- [ ] With valid URL+key, one click saves active tab; Monica routine receives `{content}` and can process (manual e2e with Jesse's webhook).
- [ ] Missing config blocks send with clear message.
- [ ] No secrets in repository.
- [ ] README covers Mac + Windows install (same steps).
- [ ] Minimal permissions: prefer `activeTab`, `storage`, `contextMenus`; host permission only for the configured webhook origin if required (document approach).
- [ ] v2: two named webhooks can be saved to separately from the popup and the context menu; mixed multi-target results show per target.
- [ ] v2: 200 / 401 / 500 / timeout / network failure each show the mapped feedback in popup and context menu (`node tests/e2e/screenshots.mjs`, local mock server only).
- [ ] v2: a v1 profile keeps working after the update (migrated to "Monica").

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
