#!/usr/bin/env node
/**
 * Build the Chrome Web Store upload zip from the committed tree.
 *
 *   node scripts/package.mjs [out.zip]     # default: dist/save-to-monica-<version>.zip
 *
 * The zip is "everything tracked except dev-only paths" (the same exclusions
 * tests/e2e/extension-copy.mjs uses), not a hand-picked list, so a file the
 * pages reference cannot be left out. Before writing it, the script checks
 * that every file the manifest, HTML, CSS and JS imports point at is in the
 * package and exits non-zero otherwise. Needs only node, git and python3.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { missingReferences, packagedFiles } from "./package-check.mjs";

// Plain deflate zip with repo-relative paths and a fixed timestamp (no `zip` binary needed).
const ZIP_PY = `import sys, zipfile
out, files = sys.argv[1], sys.argv[2:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f)
`;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(REPO, "manifest.json"), "utf8"));
const out = path.resolve(process.argv[2] ?? path.join(REPO, "dist", `save-to-monica-${manifest.version}.zip`));

const files = packagedFiles(execFileSync("git", ["-C", REPO, "ls-files"], { encoding: "utf8" }).split("\n"));
const missing = missingReferences(REPO, files);
if (missing.length) {
  console.error("Package would be missing referenced files:\n" + missing.map((m) => `  ${m.from} -> ${m.ref}`).join("\n"));
  process.exit(1);
}
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync("python3", ["-c", ZIP_PY, out, ...files], { cwd: REPO });
console.log(`${out} (${files.length} files, v${manifest.version})`);
