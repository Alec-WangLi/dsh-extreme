// T4: matchCount 语义 = lib/core/shared.mjs 的 matchesPattern（string→asLf includes；
// RegExp→cloneRegExp），只是把布尔升级成非重叠计数。测试钉住这两个不变量。
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCount } from "../lib/patch-match.mjs";
import { matchesPattern } from "../lib/core/shared.mjs";

const NEEDLE = "const WORKSPACE_CONTEXT_INTRO = 1;";
const TWICE = [NEEDLE, "middle", NEEDLE].join("\n");

test("matchCount counts non-overlapping string occurrences with CRLF normalization", () => {
  assert.equal(matchCount(TWICE, NEEDLE), 2);
  // CRLF 宿主文件 vs LF pattern（asLf 语义）
  assert.equal(matchCount(TWICE.replace(/\n/g, "\r\n"), NEEDLE), 2);
  assert.equal(matchCount("nothing here", NEEDLE), 0);
  // 非重叠：4 字符 needle 自身重复时不把 aa 计两次
  assert.equal(matchCount("aaaa", "aa"), 2);
});

test("matchCount counts RegExp occurrences without mutating the source pattern", () => {
  const re = /const WORKSPACE_CONTEXT_INTRO = \d+;/; // 无 g 标志
  assert.equal(matchCount(TWICE, re), 2);
  assert.equal(re.lastIndex, 0); // cloneRegExp 语义：不留 lastIndex
  assert.equal(matchCount("nothing here", re), 0);
  assert.equal(re.lastIndex, 0);
});

test("matchCount agrees with matchesPattern on hit and miss", () => {
  assert.equal(matchCount(TWICE, NEEDLE) > 0, matchesPattern(TWICE, NEEDLE));
  assert.equal(matchCount("nothing here", NEEDLE) > 0, matchesPattern("nothing here", NEEDLE));
});
