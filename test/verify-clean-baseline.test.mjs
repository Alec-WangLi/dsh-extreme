import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_PATCHES } from "../lib/patches/index.mjs";
import { scanTree } from "../scripts/verify-clean-baseline.mjs";

/**
 * Semantics (corrected after upstream discovery):
 * - POLLUTED verdict is driven by *.dshpurge.bak sidecars: the plugin's own
 *   write evidence (same signal as lib/core.js hasBackup()).
 * - Marker hits are informational only: restore-shaped patches (2 REPLACEMENT_
 *   WORKSPACE_CONTEXT_INTRO, 3 SCOPE_INTRO) use OFFICIAL upstream sentences as
 *   completion markers, so pristine host trees legitimately contain them
 *   (verified against sha512-verified installer extractions of 0.2.2-rc.3/rc.5).
 */

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-baseline-"));
  const aiBase = path.join(root, "dsh", "node_modules", "@deepseek-ai");
  const agentInstr = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
  fs.mkdirSync(path.dirname(agentInstr), { recursive: true });
  fs.writeFileSync(agentInstr, "// pristine host file\nexport const WORKSPACE_CONTEXT_INTRO = 1;\n", "utf8");
  return { root, aiBase, agentInstr };
}

test("clean tree: not polluted, no marker hits", () => {
  const { root } = makeTree();
  try {
    const r = scanTree(root, ALL_PATCHES);
    assert.equal(r.polluted, false);
    assert.deepEqual(r.sidecars, []);
    assert.deepEqual(r.markerHits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dshpurge.bak sidecar alone marks the tree polluted", () => {
  const { root, agentInstr } = makeTree();
  try {
    fs.writeFileSync(agentInstr + ".dshpurge.bak", "// old\n", "utf8");
    const r = scanTree(root, ALL_PATCHES);
    assert.equal(r.polluted, true);
    assert.equal(r.sidecars.length, 1);
    assert.ok(r.sidecars[0].endsWith("index.js.dshpurge.bak"), JSON.stringify(r.sidecars));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sidecar outside patch targets is still pollution evidence", () => {
  const { root } = makeTree();
  try {
    const stray = path.join(root, "dsh", "node_modules", "@deepseek-ai", "dsh-sandbox", "lib", "index.js.dshpurge.bak");
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, "// old\n", "utf8");
    const r = scanTree(root, ALL_PATCHES);
    assert.equal(r.polluted, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restore-marker in pristine-style file: marker hit listed, NOT polluted", () => {
  // Patch 2's marker is OFFICIAL_REPLACEMENT_BODY — upstream text, present in pristine hosts.
  const p2 = ALL_PATCHES.find((p) => String(p.id) === "2");
  const marker = p2.markers[0];
  const { root, agentInstr } = makeTree();
  try {
    fs.writeFileSync(agentInstr, `// pristine\n${marker}\n`, "utf8");
    const r = scanTree(root, ALL_PATCHES);
    assert.equal(r.polluted, false, "official-text marker alone must not pollute");
    assert.ok(r.markerHits.includes("2:agent-instructions"), JSON.stringify(r.markerHits));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("forward-patch marker is still recorded as marker hit (informational)", () => {
  const p1 = ALL_PATCHES.find((p) => String(p.id) === "1");
  const marker = p1.markers[0];
  const { root, agentInstr } = makeTree();
  try {
    fs.writeFileSync(agentInstr, `// dirty\n${marker}\n`, "utf8");
    const r = scanTree(root, ALL_PATCHES);
    assert.ok(r.markerHits.includes("1:agent-instructions"), JSON.stringify(r.markerHits));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("array-file patch reports the hit key", () => {
  const p4 = ALL_PATCHES.find((p) => String(p.id) === "4");
  const marker = p4.markers[0];
  const { root } = makeTree();
  try {
    const aiBase = path.join(root, "dsh", "node_modules", "@deepseek-ai");
    const webApp = path.join(aiBase, "dsh-web-app", "cordis.patch.yml");
    fs.mkdirSync(path.dirname(webApp), { recursive: true });
    fs.writeFileSync(webApp, `# dirty\n${marker}\n`, "utf8");
    const r = scanTree(root, ALL_PATCHES);
    assert.ok(r.markerHits.includes("4:web-app"), JSON.stringify(r.markerHits));
    assert.ok(!r.markerHits.includes("4:agent-preset"), JSON.stringify(r.markerHits));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
