// T6 version-metadata pins + DSH-Extreme 改名钉（1.7.22）: 版本、包名、更新源
// 必须处处一致。Mirrors scripts/check-docs.mjs but adds the rc.5 host
// declarations that check:docs cannot see.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { QUALIFIED_HOST_VERSIONS, PACKAGE, REPOSITORY } from "../lib/community.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

test("package identity is dsh-extreme 1.7.22 with 0.2.2-rc.5 compatible", () => {
  assert.equal(pkg.name, "dsh-extreme");
  assert.equal(PACKAGE, "dsh-extreme");
  assert.equal(pkg.version, "1.7.22");
  assert.equal(pkg.dsh.compatibility.dshReleases["0.2.2-rc.5"], "compatible");
  assert.equal(pkg.dsh.compatibility.dshReleases["0.2.2-rc.3"], "compatible");
});

test("update channel and install manifest point at the fork repo", () => {
  assert.equal(REPOSITORY, "Alec-WangLi/dsh-extreme");
  assert.equal(pkg.dsh.install.tarball,
    `https://github.com/Alec-WangLi/dsh-extreme/releases/download/v${pkg.version}/dsh-extreme-${pkg.version}.tgz`);
  assert.equal(pkg.dsh.install.git, "git+https://github.com/Alec-WangLi/dsh-extreme.git");
});

test("QUALIFIED_HOST_VERSIONS includes 0.2.2-rc.5", () => {
  assert.ok(QUALIFIED_HOST_VERSIONS.includes("0.2.2-rc.5"));
  assert.ok(QUALIFIED_HOST_VERSIONS.includes("0.2.2-rc.3"));
});

test("release-notes.md leads with 1.7.22 and documents the rename", () => {
  const notes = read("release-notes.md");
  assert.equal(notes.split("\n")[0].trim(), "# 1.7.22");
  const section = notes.slice(0, notes.indexOf("\n# 1.7.21"));
  assert.ok(section.includes("dsh-extreme"), "1.7.22 section must document the dsh-extreme rename");
});

test("docs/releases/1.7.22.md exists and stays under 8 KiB", () => {
  const summary = "docs/releases/1.7.22.md";
  assert.ok(fs.existsSync(new URL(`../${summary}`, import.meta.url)), `${summary} must exist`);
  const size = fs.statSync(new URL(`../${summary}`, import.meta.url)).size;
  assert.ok(size <= 8 * 1024, `${summary} is ${size} bytes, must be <= 8 KiB`);
});

test("AGENTS.md header and verified-host table carry dsh-extreme 1.7.22 + 0.2.2-rc.5", () => {
  const agents = read("AGENTS.md");
  assert.ok(agents.includes("当前版本：**1.7.22**"));
  assert.ok(agents.includes("`dsh-extreme` 1.7.22"));
  assert.ok(agents.includes("| 已验证宿主 | DSH Desktop 0.2.2-rc.5 / 0.2.2-rc.3"));
});

test("README.md and README.zh-CN.md stay identical and carry dsh-extreme 1.7.22 + rc.5", () => {
  const readme = read("README.md");
  const zh = read("README.zh-CN.md");
  assert.equal(zh, readme);
  assert.ok(readme.includes("**1.7.22**"));
  assert.match(readme, /适配 \*\*DSH Desktop 0\.2\.2-rc\.5\*\*/);
  const links = [...readme.matchAll(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/v([0-9.]+)\/dsh-extreme-([0-9.]+)\.tgz/g)];
  assert.ok(links.length > 0, "README must keep a pinned TGZ install source");
  for (const [, owner, repo, tag, archive] of links) {
    assert.equal(owner, "Alec-WangLi", "install TGZ must come from the fork repo, not upstream");
    assert.equal(repo, "dsh-extreme");
    assert.equal(tag, "1.7.22");
    assert.equal(archive, "1.7.22");
  }
});

test("docs/README.en.md, INSTALLATION.md, MAINTENANCE.md declare dsh-extreme 1.7.22", () => {
  const en = read("docs/README.en.md");
  assert.ok(en.includes("Current version 1.7.22"));
  assert.match(en, /targets \*\*DSH Desktop 0\.2\.2-rc\.5\*\*/);
  const links = [...en.matchAll(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/v([0-9.]+)\/dsh-extreme-([0-9.]+)\.tgz/g)];
  assert.ok(links.length > 0);
  for (const [, owner, repo, tag, archive] of links) {
    assert.equal(owner, "Alec-WangLi");
    assert.equal(repo, "dsh-extreme");
    assert.equal(tag, "1.7.22");
    assert.equal(archive, "1.7.22");
  }
  assert.ok(read("docs/INSTALLATION.md").includes("当前版本 **1.7.22**"));
  assert.ok(read("docs/MAINTENANCE.md").includes("当前版本 **1.7.22**"));
});
