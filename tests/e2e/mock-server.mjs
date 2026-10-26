/**
 * Local stand-in for the Monica webhook. Path picks the scenario:
 *   /ok -> 200, /401 /403 /404 /429 /500 /502 -> that status,
 *   /slow -> never answers (client timeout), /drop -> socket destroyed,
 *   /page -> a plain HTML page to right-click "save" from.
 * Records method/path/body keys and whether a Bearer header was present,
 * never the header value itself.
 *
 * Standalone: node tests/e2e/mock-server.mjs [port]
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>示例文章:如何整理网页收藏</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222;background:#fafafa}</style></head>
<body><h1>示例文章:如何整理网页收藏</h1><p id="quote">把值得回看的网页交给 agent 去整理,是减少稍后再读堆积的好办法。</p>
<p>这是 e2e 测试用的本地页面。</p></body></html>`;

export function startMockServer({ port = 0, host = "127.0.0.1" } = {}) {
  const requests = [];
  const held = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://mock");
    if (req.method === "GET" && url.pathname === "/page") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        /* recorded as null */
      }
      requests.push({
        method: req.method,
        path: url.pathname,
        bearer: /^Bearer \S+/.test(req.headers.authorization || ""),
        bodyKeys: body && typeof body === "object" ? Object.keys(body) : null,
        content: typeof body?.content === "string" ? body.content : null,
      });
      const scenario = url.pathname.split("/").pop();
      if (scenario === "slow") {
        held.add(res);
        res.on("close", () => held.delete(res));
        return;
      }
      if (scenario === "drop") {
        req.socket.destroy();
        return;
      }
      const status = scenario === "ok" ? 200 : Number(scenario) || 404;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ echo: "response bodies must never reach the UI" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({
        port: actual,
        origin: `http://${host}:${actual}`,
        requests,
        close: () =>
          new Promise((r) => {
            for (const res of held) res.destroy();
            server.closeAllConnections?.();
            server.close(r);
          }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srv = await startMockServer({ port: Number(process.argv[2]) || 8765 });
  console.log(`mock webhook on ${srv.origin} (/ok /401 /500 /slow /drop /page)`);
}
