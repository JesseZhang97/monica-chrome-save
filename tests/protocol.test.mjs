import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildContent, isConfigured, parseWebhookUrl, postToMonica } from "../lib/protocol.js";

test("buildContent matches iOS template without selection", () => {
  assert.equal(
    buildContent({ title: "Hello", url: "https://a.example/", selection: "" }),
    "标题: Hello\n链接: https://a.example/"
  );
});

test("buildContent appends selection after a blank line", () => {
  assert.equal(
    buildContent({ title: "T", url: "https://u.example/", selection: "quoted" }),
    "标题: T\n链接: https://u.example/\n\nquoted"
  );
});

test("buildContent falls back to URL when title is empty", () => {
  assert.equal(
    buildContent({ title: "  ", url: "https://only.example/" }),
    "标题: https://only.example/\n链接: https://only.example/"
  );
});

test("isConfigured requires both fields", () => {
  assert.equal(isConfigured({ webhookUrl: "", webhookKey: "k" }), false);
  assert.equal(isConfigured({ webhookUrl: "https://x", webhookKey: "" }), false);
  assert.equal(isConfigured({ webhookUrl: "https://x", webhookKey: "k" }), true);
});

test("parseWebhookUrl accepts http(s) and builds origin pattern", () => {
  const https = parseWebhookUrl("https://hooks.example.com/monica?x=1");
  assert.equal(https.ok, true);
  assert.equal(https.originPattern, "https://hooks.example.com/*");
  const httpUrl = parseWebhookUrl("http://127.0.0.1:9/path");
  assert.equal(httpUrl.ok, true);
  assert.equal(httpUrl.originPattern, "http://127.0.0.1:9/*");
  assert.equal(parseWebhookUrl("ftp://nope").ok, false);
  assert.equal(parseWebhookUrl("not a url").ok, false);
});

test("postToMonica sends only {content} plus Bearer header", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      seen.push({
        method: req.method,
        auth: req.headers.authorization,
        type: req.headers["content-type"],
        body: JSON.parse(raw),
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ignored: "nope" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const content = buildContent({
    title: "Page",
    url: "https://page.example/",
    selection: "hi",
  });
  const result = await postToMonica({
    webhookUrl: `http://127.0.0.1:${port}/ingest`,
    webhookKey: "test-key-do-not-log",
    content,
  });
  server.close();
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.message, "HTTP 201");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].auth, "Bearer test-key-do-not-log");
  assert.match(seen[0].type, /application\/json/);
  assert.deepEqual(Object.keys(seen[0].body), ["content"]);
  assert.equal(seen[0].body.content, content);
});

test("postToMonica reports HTTP status on error and does not include the key", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("nope");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const result = await postToMonica({
    webhookUrl: `http://127.0.0.1:${port}/`,
    webhookKey: "super-secret",
    content: "标题: x\n链接: y",
  });
  server.close();
  assert.equal(result.ok, false);
  assert.equal(result.kind, "http");
  assert.equal(result.status, 401);
  assert.equal(result.message, "HTTP 401");
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
});

test("missing config does not throw and explains itself", async () => {
  const result = await postToMonica({
    webhookUrl: "",
    webhookKey: "",
    content: "nope",
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "config");
  assert.match(result.message, /required/i);
});
