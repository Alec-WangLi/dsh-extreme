// T4 drift-audit：验收口径与设计文档一致 —— rc.3 基线上 drifted/restructured 必须为 0，
// rc.5 的差集就是 T5 的工单。fixture 只钉补丁 #1（agent-instructions）与 #24（preset-unrestricted，
// 验证 profile 域目标归类 out-of-tree 而不是 missing-in-tree）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_PATCHES } from "../lib/core.js";
import { runAudit, rawReplacements, classifyChained } from "../scripts/drift-audit.mjs";

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

// ─── T5 分类硬化：chained / layout-absent（justified 层，report 原状态保留）───

test("classifyChained: declared chain, replace containment, fragment, and none", () => {
  const stopwordPattern = "const guidance = resolveOptions(config);\nreturn guidance;";
  const patches = [
    { id: 900, name: "PRODUCER", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: "const upstreamBody = 1;", replace: "const upstreamBody = 1;\nfunction dshPurgeBridge(owner) { return owner; }" }],
      markers: ["dshPurgeBridgeStableMarker"] },
    { id: 901, name: "DECLARED", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      chainedAfter: 900,
      replacements: [{ pattern: "function dshPurgeBridge(owner) {", replace: "function dshPurgeBridgeV2(owner) {" }],
      markers: ["dshPurgeBridgeV2Stable"] },
    { id: 902, name: "CONTAINED", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: "function dshPurgeBridge(owner) {", replace: "/* bridged */" }],
      markers: ["dshPurgeBridgedStable"] },
    { id: 903, name: "PATTERNREF", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: "function dshPurgeZipline() { dispatch(); }", replace: "/* zip */" }],
      markers: ["dshPurgeZiplineStable"] },
    { id: 904, name: "PATTERNREF-PRODUCER", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: "const ziplineUpstream = 1;", replace: "const ziplineUpstream = 1;\ndshPurgeZipline(this);" }],
      markers: ["dshPurgeZiplineCallStable"] },
    { id: 905, name: "PLAIN", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: stopwordPattern, replace: "/* plain */" }],
      markers: ["plainStableMarker"] },
  ];
  const declared = classifyChained(patches[1], patches);
  assert.ok(declared, "declared chain found");
  assert.equal(declared.via, "declared");
  assert.equal(declared.producerId, 900);

  const contained = classifyChained(patches[2], patches);
  assert.ok(contained, "replace-containment chain found");
  assert.equal(contained.via, "replace");
  assert.equal(contained.producerId, 900);

  const patternRef = classifyChained(patches[3], patches);
  assert.ok(patternRef, "fragment chain found via another patch's pattern");
  assert.equal(patternRef.via, "fragment");
  assert.equal(patternRef.producerId, 904);

  assert.equal(classifyChained(patches[5], patches), null, "plain upstream anchor never classifies chained");
});

test("classifyChained pins the real 1.7.20 table: #46→#45, #84→#83, #88→#87, #53→#32", () => {
  const pin = (id, expected) => {
    const got = classifyChained(patch(id), ALL_PATCHES);
    assert.ok(got, `patch #${id} classifies chained`);
    assert.equal(got.producerId, expected, `patch #${id} chains on #${expected}`);
  };
  pin(46, 45); // #46 锚定 #45 的 replace 输出（marker 也是 #45 产出的）
  pin(84, 83); // #84 锚定 #83 的 replace 输出
  pin(88, 87); // 声明式 chainedAfter=87
  pin(53, 32); // #53 pattern[0] 是 #32 的 replace 输出
});

const SYN_PRISTINE = "const upstreamBody = 1;\nconst ziplineUpstream = 1;\n";

test("chained row is justified: synthetic producer/consumer audits as chained, not drifted", async () => {
  const root = mkdtemp("purge-audit-chain-");
  try {
    mkTree(root, AI_AGENT_INSTRUCTIONS, SYN_PRISTINE);
    const producer = {
      id: 900, name: "PRODUCER", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: "const upstreamBody = 1;", replace: "const upstreamBody = 1;\nfunction dshPurgeBridge(owner) { return owner; }" }],
      markers: ["dshPurgeBridgeStableMarker"],
    };
    const consumer = {
      id: 902, name: "CONSUMER", layer: "代码", file: "agent-instructions", rel: ["lib", "index.js"],
      replacements: [{ pattern: "function dshPurgeBridge(owner) {", replace: "/* bridged */" }],
      markers: ["dshPurgeBridgedStable"],
    };
    const out = await runAudit({ patches: [producer, consumer], trees: [{ id: "t", root }] });
    const prod = out.trees[0].entries.find((e) => e.id === 900);
    const cons = out.trees[0].entries.find((e) => e.id === 902);
    assert.ok(prod, "producer entry exists");
    assert.equal(prod.verdict, "matched", "producer healthy on pristine (pending)");
    assert.ok(cons, "consumer entry exists");
    assert.equal(cons.verdict, "chained", "consumer row justified as chained");
    assert.equal(cons.raw, "drifted", "raw plugin status preserved on the row");
    assert.ok(String(cons.reason).includes("900"), "reason names the producing patch");
    assert.equal(out.trees[0].summary.drifted, 0, "chained rows do not count as drift");
    assert.equal(out.trees[0].summary.restructured, 0);
    assert.equal(out.trees[0].summary.chained, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("layout-absent: nested key downgraded without nested root; uniform absence across trees downgraded; single-tree stays missing", async () => {
  // 1) 单树 + 嵌套布局不存在：#29 的 tool-web-nested 键 → layout-absent（设计如此），
  //    而 #29 主键 tool-web 在单树审计里仍报 missing-in-tree（不下结论）。
  const single = mkdtemp("purge-audit-nested-");
  try {
    const out1 = await runAudit({ trees: [{ id: "t", root: single }] });
    const nested = out1.trees[0].entries.find((e) => e.id === 29 && e.key === "tool-web-nested");
    const primary = out1.trees[0].entries.find((e) => e.id === 29 && e.key === "tool-web");
    assert.ok(nested, "nested row exists");
    assert.equal(nested.verdict, "layout-absent");
    assert.ok(String(nested.reason).includes("npm-nested"), "reason names npm-nested layout");
    assert.ok(primary, "primary row exists");
    assert.equal(primary.verdict, "missing-in-tree", "single-tree absence is not downgraded");
  } finally { fs.rmSync(single, { recursive: true, force: true }); }

  // 2) 两棵树同缺 agent-instructions：非候选树回归 → layout-absent（理由点名全部树）。
  const a = mkdtemp("purge-audit-uni-a-");
  const b = mkdtemp("purge-audit-uni-b-");
  try {
    const out2 = await runAudit({ trees: [{ id: "rc3", root: a }, { id: "rc5", root: b }] });
    for (const t of out2.trees) {
      const row = t.entries.find((e) => e.id === 1 && e.key === "agent-instructions");
      assert.ok(row, "row exists");
      assert.equal(row.verdict, "layout-absent");
      assert.ok(String(row.reason).includes("2 audited trees"), "reason names the tree count");
      assert.equal(t.summary["layout-absent"] >= 1, true);
      assert.equal(t.summary["missing-in-tree"], 0, "uniform absence leaves no failing verdict");
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
