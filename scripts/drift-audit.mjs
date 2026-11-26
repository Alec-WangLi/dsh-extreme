#!/usr/bin/env node
/**
 * Anchor drift audit across host trees (rc.3 baseline vs rc.5 candidate).
 *
 * Verdict vocabulary (per patch/key/path entry):
 * - matched      — anchor(s) present; plugin reports "pending" (pristine-healthy)
 * - applied      — completion markers already true (restore-shaped patches are
 *                  settled on pristine hosts BY DESIGN — do not alarm)
 * - drifted      — file exists, every anchor dead, no surviving tokens
 * - restructured  — anchors dead but signature tokens locate a landing zone
 * - out-of-tree  — target lives in profile scope ($DSH_HOME / third-party
 *                  plugin dirs), audited via --dsh-home only, never a tree verdict
 * - missing-in-tree — tree-scope target file absent: layout drift candidate
 * - skipped / unmatched / unreadable / na — plugin statuses passed through
 *
 * The per-file truth comes from the plugin's own patchStatusDetail (same code
 * the status page runs), with the gate forced to all patch ids so opt-in /
 * disabled-by-default patches are audited too. Anchor overrides are NOT applied:
 * rawReplacements reads the patch table as shipped, because anchor-overrides.json
 * is per-machine state and must not leak into a tree comparison.
 *
 * Usage:
 *   node scripts/drift-audit.mjs --tree rc3=C:\dev\dsh-hosts\0.2.2-rc.3\app \
 *     --tree rc5=C:\dev\dsh-hosts\0.2.2-rc.5\app \
 *     [--dsh-home <path>] [--out-json docs/drift.json] [--out-md docs/drift.md]
 */
import fs from "node:fs";
import path from "node:path";
import { ALL_PATCHES, patchStatusDetail, targetFiles } from "../lib/core.js";
import { fileKeysOf, pathsOf, asLf } from "../lib/core/shared.mjs";
import { matchCount } from "../lib/patch-match.mjs";
import { aiBaseForAppRoot } from "./verify-clean-baseline.mjs";

/** targetFiles keys whose candidates live under $DSH_HOME, never in the app tree. */
const PROFILE_ONLY_KEYS = new Set([
  "preset-unrestricted",
  "preset-liangshen",
  "preset-liangshen-pkg",
  "liangshen-tool-bootstrap",
  "compaction-instant-client",
]);

// Same stopword set as lib/core.js signatureTokens so hints agree with diagnose.
const ANCHOR_STOPWORDS = new Set([
  "function", "return", "const", "let", "var", "Promise", "resolve", "undefined",
  "typeof", "String", "startsWith", "filter", "length", "void", "async", "await",
  "this", "value", "section", "sections", "context", "options", "config",
]);

export function rawReplacements(p) {
  if (Array.isArray(p.replacements)) return p.replacements;
  return (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace }));
}

function anchorHead(pattern) {
  if (pattern instanceof RegExp) {
    return String(pattern.source).replace(/\\[ \\t]\*/g, "").replace(/\\n/g, " ⏎ ").slice(0, 200);
  }
  const line = asLf(pattern).split("\n").map((ln) => ln.replace(/\t/g, "  ")).find((ln) => ln.trim().length > 0) || "";
  return line.trim().slice(0, 200);
}

function signatureTokens(pattern) {
  const text = pattern instanceof RegExp ? String(pattern.source) : asLf(pattern);
  const ids = text.match(/[A-Za-z_$][A-Za-z0-9_$]{5,}/g) || [];
  const ranked = [...new Set(ids.filter((t) => !ANCHOR_STOPWORDS.has(t)))]
    .sort((a, b) => b.length - a.length);
  return ranked.slice(0, 8);
}

function locateHint(text, pattern) {
  const tokens = signatureTokens(pattern);
  if (!tokens.length) return null;
  const lines = asLf(text).split("\n");
  const hits = new Map();
  for (const token of tokens) {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(token)) hits.set(i, (hits.get(i) || 0) + 1);
    }
  }
  if (!hits.size) return null;
  const [bestLine] = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const from = Math.max(0, bestLine - 2);
  const to = Math.min(lines.length, bestLine + 3);
  return {
    line: bestLine + 1,
    tokens: tokens.slice(0, 4),
    snippet: lines.slice(from, to).map((l) => l.replace(/\t/g, "  ")).join("\n").slice(0, 600),
  };
}

function isUnder(child, parent) {
  const rel = path.relative(String(parent), String(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const textCache = new Map();
function loadText(fp) {
  if (!textCache.has(fp)) {
    try {
      textCache.set(fp, fs.readFileSync(fp, "utf8"));
    } catch {
      textCache.set(fp, null);
    }
  }
  return textCache.get(fp);
}

function rowVerdict(row, p) {
  if (row.status === "drifted") {
    const text = loadText(row.path);
    const reps = rawReplacements(p);
    const hint = text == null ? null : firstHint(text, reps);
    return hint ? { verdict: "restructured", hint } : { verdict: "drifted", hint: null };
  }
  switch (row.status) {
    case "applied": return { verdict: "applied", hint: null };
    case "pending": return { verdict: "matched", hint: null };
    case "skipped": return { verdict: "skipped", hint: null };
    case "unmatched": return { verdict: "unmatched", hint: null };
    case "unreadable": return { verdict: "unreadable", hint: null };
    case "restored": return { verdict: "matched", hint: null };
    default: return { verdict: row.status, hint: null };
  }
}

function firstHint(text, reps) {
  for (const { pattern } of reps) {
    if (!pattern) continue;
    const hint = locateHint(text, pattern);
    if (hint) return hint;
  }
  return null;
}

function patternEvidence(p, fp) {
  const text = loadText(fp);
  if (text == null) return null;
  return rawReplacements(p)
    .filter((rep) => rep && rep.pattern)
    .map((rep, index) => ({
      index,
      occurrences: matchCount(text, rep.pattern),
      anchorHead: anchorHead(rep.pattern),
    }));
}

function buildEntries({ patches, root, aiBase, dshHome, report }) {
  const files = targetFiles(aiBase, dshHome);
  const entries = [];
  for (const p of patches) {
    const rows = report.files[p.id] || [];
    const keys = fileKeysOf(p);
    const rowsByKey = new Map();
    for (const row of rows) {
      const key = row.key ?? "(legacy)";
      if (!rowsByKey.has(key)) rowsByKey.set(key, []);
      rowsByKey.get(key).push(row);
    }
    const emittedKeys = new Set();
    for (const [key, keyRows] of rowsByKey) {
      for (const row of keyRows) {
        const outsideTree = !isUnder(row.path, root);
        if (outsideTree) {
          entries.push({
            id: p.id, name: p.name, layer: p.layer, key, path: row.path,
            verdict: "out-of-tree", report: row.status, reason: "profile-scope target",
          });
          continue;
        }
        const { verdict, hint } = rowVerdict(row, p);
        const base = {
          id: p.id, name: p.name, layer: p.layer, key, path: row.path,
          verdict, report: row.status,
        };
        if (verdict === "drifted" || verdict === "restructured") base.hint = hint;
        if (verdict === "matched" || verdict === "drifted" || verdict === "restructured") {
          const patterns = patternEvidence(p, row.path);
          if (patterns) base.patterns = patterns;
        }
        entries.push(base);
      }
      emittedKeys.add(key);
    }
    // Keys with no existing target file at all (readPatchReport emits no rows).
    for (const key of keys) {
      if (emittedKeys.has(key) || rowsByKey.has(key)) continue;
      const fps = pathsOf(files, key);
      if (fps.length > 0) continue; // rows exist — handled above (or legacy rows)
      entries.push({
        id: p.id, name: p.name, layer: p.layer, key, path: "",
        verdict: PROFILE_ONLY_KEYS.has(key) ? "out-of-tree" : "missing-in-tree",
        report: "missing_file",
        reason: PROFILE_ONLY_KEYS.has(key) ? "profile-scope target" : "tree-scope target absent",
      });
    }
    // Patch-level statuses with no detail rows at all (surface-na, disabled, unknown).
    if (rows.length === 0) {
      const st = report.status[p.id];
      if (st && st !== "missing_file") {
        entries.push({
          id: p.id, name: p.name, layer: p.layer, key: "", path: "",
          verdict: st === "na" ? "na-surface" : st, report: st,
          reason: "patch-level status",
        });
      }
    }
  }
  return entries;
}

function summarize(entries) {
  const summary = {
    matched: 0, applied: 0, drifted: 0, restructured: 0, "out-of-tree": 0,
    "missing-in-tree": 0, skipped: 0, unmatched: 0, unreadable: 0, other: 0,
    driftedIds: [], missingInTreeKeys: [],
  };
  for (const e of entries) {
    if (e.verdict in summary && typeof summary[e.verdict] === "number") summary[e.verdict] += 1;
    else summary.other += 1;
    if (e.verdict === "drifted" || e.verdict === "restructured") {
      if (!summary.driftedIds.includes(e.id)) summary.driftedIds.push(e.id);
    }
    if (e.verdict === "missing-in-tree") {
      const tag = `#${e.id}:${e.key}`;
      if (!summary.missingInTreeKeys.includes(tag)) summary.missingInTreeKeys.push(tag);
    }
  }
  return summary;
}

function diffTrees(base, cand) {
  const driftFlag = (t) => new Set(t.summary.driftedIds);
  const missingFlag = (t) => new Set(t.summary.missingInTreeKeys);
  const baseDrift = driftFlag(base);
  const candDrift = driftFlag(cand);
  const baseMissing = missingFlag(base);
  const candMissing = missingFlag(cand);
  return {
    newDriftedIds: [...candDrift].filter((id) => !baseDrift.has(id)),
    newDriftedIdsInBaseline: [...baseDrift].filter((id) => !candDrift.has(id)),
    newMissingKeys: [...candMissing].filter((k) => !baseMissing.has(k)),
    resolvedMissingKeys: [...baseMissing].filter((k) => !candMissing.has(k)),
  };
}

function readHostVersion(appRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(String(appRoot), "package.json"), "utf8")).version || "?";
  } catch {
    return "?";
  }
}

export async function runAudit({ patches = ALL_PATCHES, trees, dshHome, surface = "desktop" } = {}) {
  if (!Array.isArray(trees) || trees.length === 0) throw new Error("runAudit requires trees: [{id, root}]");
  const allIds = patches.map((p) => p.id);
  const results = [];
  for (const tree of trees) {
    const aiBase = aiBaseForAppRoot(tree.root);
    const report = await patchStatusDetail(aiBase, patches, {
      dshHome, surface, extraPatches: allIds,
    });
    const entries = buildEntries({ patches, root: tree.root, aiBase, dshHome, report });
    results.push({
      id: tree.id, root: tree.root, version: readHostVersion(tree.root),
      entries, summary: summarize(entries),
    });
  }
  return {
    trees: results,
    diff: results.length === 2 ? diffTrees(results[0], results[1]) : null,
  };
}

function mdReport(out) {
  const lines = [];
  const now = new Date().toISOString();
  lines.push(`# dsh-purge anchor drift audit — ${now}`);
  lines.push("");
  for (const t of out.trees) {
    lines.push(`## ${t.id} (${t.version}) — ${t.root}`);
    lines.push("");
    lines.push("| verdict | count |");
    lines.push("| --- | --- |");
    for (const [k, v] of Object.entries(t.summary)) {
      if (typeof v === "number") lines.push(`| ${k} | ${v} |`);
    }
    lines.push("");
    if (t.summary.driftedIds.length) lines.push(`drifted/restructured patch ids: ${t.summary.driftedIds.join(", ")}`);
    if (t.summary.missingInTreeKeys.length) lines.push(`missing-in-tree targets: ${t.summary.missingInTreeKeys.join(", ")}`);
    lines.push("");
    for (const e of t.entries) {
      if (!["drifted", "restructured", "missing-in-tree", "unmatched", "unreadable"].includes(e.verdict)) continue;
      lines.push(`### #${e.id} ${e.name} [${e.verdict}] key=${e.key}`);
      if (e.path) lines.push(`- path: ${e.path}`);
      if (e.patterns) {
        for (const pat of e.patterns) {
          lines.push(`- pattern[${pat.index}] ×${pat.occurrences}: \`${pat.anchorHead}\``);
        }
      }
      if (e.hint) lines.push(`- hint: line ${e.hint.line}, tokens ${e.hint.tokens.join("/")}\n\n  \`\`\`\n  ${e.hint.snippet.replace(/\n/g, "\n  ")}\n  \`\`\``);
      lines.push("");
    }
  }
  if (out.diff) {
    lines.push("## diff (baseline → candidate)");
    lines.push("");
    lines.push(`- new drifted ids: ${out.diff.newDriftedIds.join(", ") || "none"}`);
    lines.push(`- drifted in baseline only: ${out.diff.newDriftedIdsInBaseline.join(", ") || "none"}`);
    lines.push(`- new missing keys: ${out.diff.newMissingKeys.join(", ") || "none"}`);
    lines.push(`- resolved missing keys: ${out.diff.resolvedMissingKeys.join(", ") || "none"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const trees = [];
  let dshHome;
  let outJson;
  let outMd;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--tree") {
      const [id, root] = String(argv[i + 1] || "").split("=");
      if (!id || !root) return usage(2);
      trees.push({ id, root });
      i += 1;
    } else if (a === "--dsh-home") {
      dshHome = argv[i + 1]; i += 1;
    } else if (a === "--out-json") {
      outJson = argv[i + 1]; i += 1;
    } else if (a === "--out-md") {
      outMd = argv[i + 1]; i += 1;
    } else if (a === "--help" || a === "-h") {
      return usage(0);
    } else {
      return usage(2);
    }
  }
  if (!trees.length) return usage(2);
  return runAudit({ trees, dshHome }).then((out) => {
    const payload = JSON.stringify({ generatedAt: new Date().toISOString(), ...out }, null, 2);
    if (outJson) fs.writeFileSync(outJson, payload + "\n", "utf8");
    if (outMd) fs.writeFileSync(outMd, mdReport(out), "utf8");
    if (!outJson && !outMd) process.stdout.write(payload + "\n");
    for (const t of out.trees) {
      console.error(`[${t.id}] drifted=${t.summary.drifted} restructured=${t.summary.restructured} missing-in-tree=${t.summary["missing-in-tree"]}`);
    }
    if (out.diff) console.error(`diff: newDrifted=[${out.diff.newDriftedIds}] newMissing=[${out.diff.newMissingKeys}]`);
    const bad = out.trees.some((t) => t.summary.drifted > 0 || t.summary.restructured > 0 || t.summary["missing-in-tree"] > 0);
    process.exitCode = bad ? 1 : 0;
  }).catch((e) => {
    console.error(e && e.stack ? e.stack : String(e));
    process.exitCode = 2;
  });
}

function usage(code) {
  process.stderr.write([
    "usage: node scripts/drift-audit.mjs --tree <id>=<appRoot> [--tree <id>=<appRoot>]",
    "  [--dsh-home <path>] [--out-json <file>] [--out-md <file>]",
    "exit 0 = clean (no drifted/restructured/missing-in-tree), 1 = findings, 2 = bad args",
  ].join("\n") + "\n");
  process.exitCode = code;
  return Promise.resolve();
}

if (process.argv[1]?.endsWith("drift-audit.mjs")) {
  main();
}
