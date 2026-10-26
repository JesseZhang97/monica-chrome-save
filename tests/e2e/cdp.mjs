/**
 * Minimal Chrome DevTools Protocol driver over --remote-debugging-pipe.
 * Branded Chrome ignores --load-extension, but Extensions.loadUnpacked works
 * on a pipe connection with --enable-unsafe-extension-debugging.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export async function launchChrome({ binary = process.env.CHROME_BIN || "google-chrome", headless = true } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), "mcs-e2e-"));
  const args = [
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    `--user-data-dir=${profile}`,
    "--window-size=1280,900",
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new");
  if (process.getuid?.() === 0) args.unshift("--no-sandbox");
  const proc = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const writer = proc.stdio[3];
  const reader = proc.stdio[4];
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;
  let buffer = "";

  reader.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id != null && pending.has(message.id)) {
        const { resolve, reject, method } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      } else {
        for (const fn of listeners) fn(message);
      }
    }
  });

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      writer.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  }

  function waitForEvent(predicate, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(fn);
        reject(new Error("Timed out waiting for CDP event"));
      }, timeoutMs);
      const fn = (message) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        listeners.delete(fn);
        resolve(message);
      };
      listeners.add(fn);
    });
  }

  async function close() {
    try {
      await Promise.race([send("Browser.close"), new Promise((r) => setTimeout(r, 2000))]);
    } catch {
      /* already gone */
    }
    if (proc.exitCode == null) {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    }
    // Chrome helper processes can still be flushing the profile right after exit.
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt >= 10) {
          console.warn(`could not remove temp profile ${profile}: ${error.code}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  await send("Target.setDiscoverTargets", { discover: true });
  return { send, waitForEvent, close, proc };
}

/** Attach to a target and return helpers bound to its session. */
export async function attach(browser, targetId) {
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => browser.send(method, params, sessionId);
  async function evaluate(expression, { userGesture = false } = {}) {
    const res = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (res.exceptionDetails) {
      const text = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`evaluate failed: ${text}`);
    }
    return res.result.value;
  }
  return { sessionId, targetId, call, evaluate };
}

export async function findTarget(browser, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { targetInfos } = await browser.send("Target.getTargets");
    const hit = targetInfos.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Target not found");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
