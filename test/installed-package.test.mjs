// DSH-Extreme 改名后的别名解析钉：主名 dsh-extreme；旧名 dsh-purge-community /
// dsh-purge 仍可解析（迁移窗口与回滚依赖它们），陌生名一律拒绝。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { installedCommunityPackage, COMMUNITY_PACKAGE } from "../lib/installed-package.js";

const CLEANUP = [];
after(() => { for (const p of CLEANUP) fs.rmSync(p, { recursive: true, force: true }); });

function makeProfile(entries, bundles) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "installed-pkg-"));
  CLEANUP.push(profile);
  for (const [name, pkg] of Object.entries(entries)) {
    const dir = path.join(profile, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  }
  fs.writeFileSync(path.join(profile, "package.json"),
    JSON.stringify({ dsh: { profile: { bundles } } }));
  return profile;
}

test("COMMUNITY_PACKAGE is the new primary name", () => {
  assert.equal(COMMUNITY_PACKAGE, "dsh-extreme");
});

test("resolves the primary install from bundles", () => {
  const profile = makeProfile(
    { "dsh-extreme": { name: "dsh-extreme", version: "1.7.22" } },
    ["dsh-extreme"]);
  const found = installedCommunityPackage(profile);
  assert.equal(found.dependencyName, "dsh-extreme");
  assert.equal(found.package.version, "1.7.22");
});

test("resolves a legacy dsh-purge-community install during the migration window", () => {
  const profile = makeProfile(
    { "dsh-purge-community": { name: "dsh-purge-community", version: "1.7.21" } },
    ["dsh-purge-community"]);
  const found = installedCommunityPackage(profile);
  assert.equal(found.dependencyName, "dsh-purge-community");
  assert.equal(found.package.version, "1.7.21");
});

test("legacy dependency names are accepted explicitly, unknown names rejected", () => {
  const profile = makeProfile(
    { "dsh-purge-community": { name: "dsh-purge-community", version: "1.7.21" } },
    []);
  assert.equal(installedCommunityPackage(profile, { dependencyName: "dsh-purge-community" }).package.version, "1.7.21");
  assert.throws(() => installedCommunityPackage(profile, { dependencyName: "not-a-plugin" }), /Unsupported plugin dependency name/);
});

test("a package that is not one of our identities is rejected", () => {
  const profile = makeProfile(
    { "dsh-extreme": { name: "someone-elses-package", version: "9.9.9" } },
    ["dsh-extreme"]);
  assert.throws(() => installedCommunityPackage(profile), /无效/);
});

test("two live installs still conflict", () => {
  const profile = makeProfile({
    "dsh-extreme": { name: "dsh-extreme", version: "1.7.22" },
    "dsh-purge-community": { name: "dsh-purge-community", version: "1.7.21" },
  }, ["dsh-extreme", "dsh-purge-community"]);
  assert.throws(() => installedCommunityPackage(profile), /多个社区版安装/);
});
