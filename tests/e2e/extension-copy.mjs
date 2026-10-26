/**
 * Copy the extension to a temp dir with http://127.0.0.1/* granted up front.
 * Headless Chrome cannot click the optional-permission prompt, so the copy
 * declares the mock server's origin as a required host permission. Any other
 * origin (e.g. http://localhost) stays ungranted to exercise the
 * "未授权" path. The repo's manifest.json is never modified.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function grantMockOrigin(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/** Working-tree copy. Pass `dir` to replace an already loaded copy in place (an "update"). */
export function prepareExtension(dir = mkdtempSync(path.join(tmpdir(), "mcs-ext-"))) {
  for (const entry of readdirSync(dir)) rmSync(path.join(dir, entry), { recursive: true, force: true });
  cpSync(REPO, dir, {
    recursive: true,
    filter: (src) => !/[\\/](\.git|tests|docs|scripts|node_modules)([\\/]|$)/.test(src.slice(REPO.length)),
  });
  grantMockOrigin(dir);
  return dir;
}

/** The extension as shipped at a git ref (e.g. v1), to test upgrades. */
export function prepareExtensionAt(ref) {
  const dir = mkdtempSync(path.join(tmpdir(), "mcs-ext-"));
  const archive = execFileSync("git", ["-C", REPO, "archive", "--format=tar", ref]);
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  grantMockOrigin(dir);
  return dir;
}
