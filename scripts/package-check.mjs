/**
 * Which tracked files ship in the store package, and whether every file the
 * extension itself refers to is among them. Shared by scripts/package.mjs and
 * tests/package.test.mjs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEV_ONLY = /^(tests|docs|scripts|dist|node_modules)\/|^\.|\.md$/;

/** Tracked files that go into the zip: everything except dev-only paths. */
export function packagedFiles(tracked) {
  return tracked.filter((file) => file && !DEV_ONLY.test(file));
}

function isLocal(ref) {
  return ref && !/^([a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(ref);
}

/** Local files named by the manifest, by HTML src/href, CSS url()/@import and JS import/importScripts. */
export function referencesOf(repo, files) {
  const refs = [];
  const add = (from, ref, base = path.posix.dirname(from)) => {
    if (!isLocal(ref)) return;
    const clean = ref.split(/[?#]/)[0];
    refs.push({ from, ref, target: path.posix.normalize(clean.startsWith("/") ? clean.slice(1) : path.posix.join(base, clean)) });
  };
  const read = (file) => readFileSync(path.join(repo, file), "utf8");
  const manifest = JSON.parse(read("manifest.json"));
  const manifestRefs = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
    ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
    ...(manifest.web_accessible_resources ?? []).flatMap((w) => w.resources ?? []),
  ];
  for (const ref of manifestRefs) add("manifest.json", ref, ".");
  for (const file of files) {
    if (/\.html$/.test(file)) {
      for (const m of read(file).matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) add(file, m[1]);
    } else if (/\.css$/.test(file)) {
      for (const m of read(file).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/g)) add(file, m[1] ?? m[2]);
    } else if (/\.js$/.test(file)) {
      for (const m of read(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|importScripts\(\s*)['"](\.{0,2}\/[^'"]+)['"]/g)) add(file, m[1]);
      for (const m of read(file).matchAll(/chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]/g)) add(file, m[1], ".");
    }
  }
  return refs;
}

/** References whose target is not in the package (or not on disk). */
export function missingReferences(repo, files) {
  const shipped = new Set(files);
  return referencesOf(repo, files).filter((r) => !shipped.has(r.target) || !existsSync(path.join(repo, r.target)));
}
