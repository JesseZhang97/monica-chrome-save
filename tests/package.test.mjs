import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { missingReferences, packagedFiles, referencesOf } from "../scripts/package-check.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync("git", ["-C", REPO, "ls-files"], { encoding: "utf8" }).split("\n");
const files = packagedFiles(tracked);

test("the package keeps runtime files and drops dev-only ones", () => {
  for (const f of ["manifest.json", "background.js", "popup.html", "options.html", "styles/ui.css", "icons/icon128.png", "icons/logo.svg"]) {
    assert.ok(files.includes(f), `${f} should ship`);
  }
  for (const f of files) assert.doesNotMatch(f, /^(tests|docs|scripts)\/|\.md$|^\./, `${f} should not ship`);
});

test("every file the manifest, pages, styles and scripts refer to is in the package", () => {
  const refs = referencesOf(REPO, files);
  assert.ok(refs.some((r) => r.target === "icons/logo.svg"), "the logo reference is scanned");
  assert.deepEqual(missingReferences(REPO, files).map((m) => `${m.from} -> ${m.ref}`), []);
});
