// 发布源两次迁移：YuJunZhiXue/dsh-purge（被删）→ kingcharleslzy-ai/dsh-purge
// → 本仓库 Alec-WangLi/dsh-extreme（DSH-Extreme 改名自立）。发布源必须指向
// 本仓库，否则 beta/zip 通道 404；旧仓库 URL 一律不得再出现在下载链里。
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_REPO, UPSTREAM_REPO, archiveZipUrl, archiveTarballUrl } from "../lib/update-net.js";
import { REPOSITORY } from "../lib/community.js";

test("update sources point at this repository", () => {
  assert.equal(SOURCE_REPO, "Alec-WangLi/dsh-extreme");
  assert.equal(UPSTREAM_REPO, SOURCE_REPO);
  assert.equal(REPOSITORY, SOURCE_REPO);
});

test("archive URLs never reference the removed upstream", () => {
  for (const url of [archiveZipUrl("v1.6.36"), archiveTarballUrl("v1.6.36")]) {
    assert.match(url, /Alec-WangLi\/dsh-extreme/);
    assert.doesNotMatch(url, /YuJunZhiXue|kingcharleslzy-ai/);
  }
});
