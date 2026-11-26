// T6 version-metadata pins: 1.7.21 must declare 0.2.2-rc.5 everywhere the
// project treats as authoritative. Mirrors scripts/check-docs.mjs but adds
// the rc.5 host declarations that check:docs cannot see.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { QUALIFIED_HOST_VERSIONS } from "../lib/community.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

test("package.json declares version 1.7.21 with 0.2.2-rc.5 compatible", () => {
  assert.equal(pkg.version, "1.7.21");
  assert.equal(pkg.dsh.compatibility.dshReleases["0.2.2-rc.5"], "compatible");
  assert.equal(pkg.dsh.compatibility.dshReleases["0.2.2-rc.3"], "compatible");
});

test("QUALIFIED_HOST_VERSIONS includes 0.2.2-rc.5", () => {
  assert.ok(QUALIFIED_HOST_VERSIONS.includes("0.2.2-rc.5"));
  assert.ok(QUALIFIED_HOST_VERSIONS.includes("0.2.2-rc.3"));
});

test("release-notes.md leads with 1.7.21 and documents the rc.5 audit", () => {
  const notes = read("release-notes.md");
  assert.equal(notes.split("\n")[0].trim(), "# 1.7.21");
  const section = notes.slice(0, notes.indexOf("\n# 1.7.20"));
  assert.ok(section.includes("0.2.2-rc.5"), "1.7.21 section must mention 0.2.2-rc.5");
});

test("docs/releases/1.7.21.md exists and stays under 8 KiB", () => {
  const summary = "docs/releases/1.7.21.md";
  assert.ok(fs.existsSync(new URL(`../${summary}`, import.meta.url)), `${summary} must exist`);
  const size = fs.statSync(new URL(`../${summary}`, import.meta.url)).size;
  assert.ok(size <= 8 * 1024, `${summary} is ${size} bytes, must be <= 8 KiB`);
});

test("AGENTS.md header and verified-host table carry 1.7.21 + 0.2.2-rc.5", () => {
  const agents = read("AGENTS.md");
  assert.ok(agents.includes("当前版本：**1.7.21**"));
  assert.ok(agents.includes("`dsh-purge-community` 1.7.21"));
  assert.ok(agents.includes("| 已验证宿主 | DSH Desktop 0.2.2-rc.5 / 0.2.2-rc.3"));
});

test("README.md and README.zh-CN.md stay identical and carry 1.7.21 + rc.5", () => {
  const readme = read("README.md");
  const zh = read("README.zh-CN.md");
  assert.equal(zh, readme);
  assert.ok(readme.includes("**1.7.21**"));
  assert.match(readme, /适配 \*\*DSH Desktop 0\.2\.2-rc\.5\*\*/);
  const links = [...readme.matchAll(/releases\/download\/v([0-9.]+)\/dsh-purge-community-([0-9.]+)\.tgz/g)];
  assert.ok(links.length > 0, "README must keep a pinned TGZ install source");
  for (const [, tag, archive] of links) {
    assert.equal(tag, "1.7.21");
    assert.equal(archive, "1.7.21");
  }
});

test("docs/README.en.md, INSTALLATION.md, MAINTENANCE.md declare 1.7.21", () => {
  const en = read("docs/README.en.md");
  assert.ok(en.includes("Current version 1.7.21"));
  assert.match(en, /targets \*\*DSH Desktop 0\.2\.2-rc\.5\*\*/);
  const links = [...en.matchAll(/releases\/download\/v([0-9.]+)\/dsh-purge-community-([0-9.]+)\.tgz/g)];
  assert.ok(links.length > 0);
  for (const [, tag, archive] of links) {
    assert.equal(tag, "1.7.21");
    assert.equal(archive, "1.7.21");
  }
  assert.ok(read("docs/INSTALLATION.md").includes("当前版本 **1.7.21**"));
  assert.ok(read("docs/MAINTENANCE.md").includes("当前版本 **1.7.21**"));
});
