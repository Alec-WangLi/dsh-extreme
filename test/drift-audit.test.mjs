// T4 drift-audit：验收口径与设计文档一致 —— rc.3 基线上 drifted/restructured 必须为 0，
// rc.5 的差集就是 T5 的工单。fixture 只钉补丁 #1（agent-instructions）与 #24（preset-unrestricted，
// 验证 profile 域目标归类 out-of-tree 而不是 missing-in-tree）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_PATCHES } from "../lib/core.js";
import { runAudit, rawReplacements } from "../scripts/drift-audit.mjs";

const patch = (id) => {
  const found = ALL_PATCHES.find((p) => p.id === id);
  assert.ok(found, `patch #${id} must exist`);
  return found;
};

const P1_ANCHOR = rawReplacements(patch(1))[0].pattern;
assert.equal(typeof P1_ANCHOR, "string");

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const AI_AGENT_INSTRUCTIONS = path.join("dsh", "node_modules", "@deepseek-ai", "dsh-agent-instructions", "lib", "index.js");

function mkTree(root, relToAiBase, content) {
  const fp = path.join(root, relToAiBase);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
  return fp;
}

// 三个宿主树：命中 / 重构（token 还在、锚点变了）/ 漂移（彻底找不到）
const TREE_MATCHED = () => {
  const root = mkdtemp("purge-audit-matched-");
  mkTree(root, AI_AGENT_INSTRUCTIONS, [P1_ANCHOR, "middle", P1_ANCHOR].join("\n"));
  return root;
};
const TREE_RESTRUCTURED = () => {
  const root = mkdtemp("purge-audit-restructured-");
  // 改锚点中段两个实词（guidance/precedence）：其余 token（WORKSPACE_CONTEXT_INTRO、
  // instructions、following…）还在 → 能定位落点，但精确 pattern 不再命中。
  const mutated = P1_ANCHOR.replace("guidance", "gvidance").replace("precedence", "precednce");
  mkTree(root, AI_AGENT_INSTRUCTIONS, mutated);
  return root;
};
const TREE_DRIFTED = () => {
  const root = mkdtemp("purge-audit-drifted-");
  mkTree(root, AI_AGENT_INSTRUCTIONS, "nothing to see here\nfunction foo() {}\n");
  return root;
};

const p1Entry = (entries) =>
  entries.find((e) => e.id === 1 && e.key === "agent-instructions" && e.verdict !== "out-of-tree");

test("matched tree: patch #1 verdict matched with per-pattern occurrences", async () => {
  const root = TREE_MATCHED();
  try {
    const out = await runAudit({ trees: [{ id: "t", root }] });
    const entry = p1Entry(out.trees[0].entries);
    assert.ok(entry, "patch #1 entry exists");
    assert.equal(entry.verdict, "matched");
    assert.equal(entry.report, "pending"); // 插件口径：pristine + 锚点在 = pending
    assert.equal(entry.patterns[0].occurrences, 2);
    assert.ok(entry.patterns.length >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("restructured tree: anchor dead but tokens locate a landing zone", async () => {
  const root = TREE_RESTRUCTURED();
  try {
    const out = await runAudit({ trees: [{ id: "t", root }] });
    const entry = p1Entry(out.trees[0].entries);
    assert.equal(entry.verdict, "restructured");
    assert.equal(entry.patterns[0].occurrences, 0);
    assert.ok(entry.hint, "hint present");
    assert.equal(entry.hint.line > 0, true);
    assert.equal(entry.report, "drifted");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("drifted tree: anchor dead and no tokens survive", async () => {
  const root = TREE_DRIFTED();
  try {
    const out = await runAudit({ trees: [{ id: "t", root }] });
    const entry = p1Entry(out.trees[0].entries);
    assert.equal(entry.verdict, "drifted");
    assert.equal(entry.hint, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("empty tree: patch #1 target missing inside the host tree", async () => {
  const root = mkdtemp("purge-audit-empty-");
  try {
    const out = await runAudit({ trees: [{ id: "t", root }] });
    const entry = out.trees[0].entries.find((e) => e.id === 1 && e.verdict === "missing-in-tree");
    assert.ok(entry, "missing-in-tree entry exists");
    assert.equal(entry.key, "agent-instructions");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("profile-scope target: preset-unrestricted classifies out-of-tree, not missing", async () => {
  const root = mkdtemp("purge-audit-profile-tree-");
  const dshHome = mkdtemp("purge-audit-profile-home-");
  try {
    const P24_ANCHOR = rawReplacements(patch(24))[0].pattern;
    mkTree(dshHome, path.join(".agent-presets", "unrestricted", "agent.cordis.yml"), P24_ANCHOR);
    const out = await runAudit({ trees: [{ id: "t", root }], dshHome });
    const e24 = out.trees[0].entries.find((e) => e.id === 24 && e.key === "preset-unrestricted");
    assert.ok(e24, "patch #24 preset-unrestricted entry exists");
    assert.equal(e24.verdict, "out-of-tree");
    assert.equal(e24.report, "pending"); // 锚点在 profile 副本里仍然命中（插件口径 pending）
    const missing = out.trees[0].entries.find((e) => e.id === 24 && e.key === "preset-unrestricted" && e.verdict === "missing-in-tree");
    assert.equal(missing, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dshHome, { recursive: true, force: true });
  }
});

test("summary counts match entries and diff flags newly drifted patches", async () => {
  const good = TREE_MATCHED();
  const bad = TREE_DRIFTED();
  try {
    const out = await runAudit({ trees: [{ id: "rc3", root: good }, { id: "rc5", root: bad }] });
    for (const tree of out.trees) {
      const counted = tree.entries.filter((e) => e.verdict === "drifted").length;
      assert.equal(tree.summary.drifted, counted);
      const restr = tree.entries.filter((e) => e.verdict === "restructured").length;
      assert.equal(tree.summary.restructured, restr);
    }
    assert.ok(out.diff, "diff present for two trees");
    assert.ok(out.diff.newDriftedIds.includes(1), "patch #1 flagged as newly drifted in rc5");
    assert.deepEqual(out.diff.newDriftedIdsInBaseline, []);
  } finally {
    fs.rmSync(good, { recursive: true, force: true });
    fs.rmSync(bad, { recursive: true, force: true });
  }
});
