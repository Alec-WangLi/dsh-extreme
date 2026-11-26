/**
 * Clean-baseline verifier: is a host app tree usable as a pristine baseline?
 *
 * Verdict semantics:
 * - POLLUTED  — the tree contains *.dshpurge.bak sidecars: direct evidence of
 *   purge writes (same signal as lib/core.js hasBackup()). Marker hits alone
 *   are NOT a verdict: restore-shaped patches (e.g. #2/#3) carry OFFICIAL
 *   upstream sentences as completion markers, which pristine hosts contain
 *   (verified against sha512-verified installer extractions 0.2.2-rc.3/rc.5).
 * - markerHits are reported informationally for manual review.
 *
 * Usage: node scripts/verify-clean-baseline.mjs <appRoot>
 *   exit 0 = usable clean baseline, exit 1 = polluted, exit 2 = bad args
 */
import fs from "node:fs";
import path from "node:path";
import { targetFiles } from "../lib/core.js";
import { ALL_PATCHES } from "../lib/patches/index.mjs";

export function aiBaseForAppRoot(appRoot) {
  return path.join(String(appRoot), "dsh", "node_modules", "@deepseek-ai");
}

const BAK_SUFFIX = ".dshpurge.bak";

/** Recursive walk collecting *.dshpurge.bak sidecars under appRoot. */
export function findBakSidecars(appRoot) {
  const out = [];
  const stack = [String(appRoot)];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (e.isFile() && e.name.endsWith(BAK_SUFFIX)) out.push(fp);
    }
  }
  return out.sort();
}

/**
 * Scan a host app tree for purge pollution and marker hits.
 * @param {string} appRoot host app dir (contains package.json and dsh/)
 * @param {Array} patches ALL_PATCHES-shaped list
 * @returns {{polluted: boolean, sidecars: string[], markerHits: string[]}}
 */
export function scanTree(appRoot, patches) {
  const sidecars = findBakSidecars(appRoot);
  const aiBase = aiBaseForAppRoot(appRoot);
  // dshHome := appRoot keeps profile-local lookups (agent presets etc.)
  // inside the audited tree; on a clean extraction they are absent.
  const files = targetFiles(aiBase, String(appRoot));
  const hits = new Set();
  for (const p of patches) {
    const markers = [
      ...((Array.isArray(p.markers) && p.markers) || []),
      ...((Array.isArray(p.markersAny) && p.markersAny) || []),
    ].filter((m) => typeof m === "string" && m.length > 0);
    if (!markers.length) continue;
    const keys = Array.isArray(p.file) ? p.file : [p.file];
    for (const key of keys) {
      const fp = files[key];
      if (!fp || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) continue;
      let content;
      try {
        content = fs.readFileSync(fp, "utf8");
      } catch {
        continue;
      }
      if (markers.some((m) => content.includes(m))) {
        hits.add(`${p.id}:${key}`);
      }
    }
  }
  return { polluted: sidecars.length > 0, sidecars, markerHits: [...hits].sort() };
}

export function main(argv = process.argv.slice(2)) {
  const appRoot = argv[0];
  if (!appRoot) {
    console.error("usage: node scripts/verify-clean-baseline.mjs <appRoot>");
    process.exitCode = 2;
    return;
  }
  const r = scanTree(appRoot, ALL_PATCHES);
  for (const h of r.markerHits) console.error(`marker hit (informational): ${h}`);
  if (r.polluted) {
    console.error(`POLLUTED BASELINE: ${r.sidecars.length} .dshpurge.bak sidecar(s):`);
    for (const s of r.sidecars) console.error(`  ${s}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    r.markerHits.length
      ? `CLEAN BASELINE (sidecar scan) — ${r.markerHits.length} informational marker hit(s) above; restore-shaped patches use official-text markers.`
      : "CLEAN BASELINE: no .dshpurge.bak sidecars, no marker hits.",
  );
}

if (process.argv[1]?.endsWith("verify-clean-baseline.mjs")) {
  main();
}
