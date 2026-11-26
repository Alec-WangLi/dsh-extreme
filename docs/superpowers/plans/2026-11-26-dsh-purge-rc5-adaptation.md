# dsh-purge rc.5 适配 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork kingcharleslzy-ai/dsh-purge (v1.7.20) 并把全部宿主树锚点适配 DSH Desktop 0.2.2-rc.5，产出可安装的 1.7.21 tarball 与升级当天 runbook。

**Architecture:** 不改插件功能语义，只修锚点。核心是一个新审计工具 `scripts/drift-audit.mjs`：导入 `ALL_PATCHES` 补丁表，对干净 rc.3 基准与 rc.5 解包树逐 pattern 匹配（匹配器复用插件自身逻辑），产出三类漂移报告；修复循环由报告驱动，每修一个锚点走一次 TDD。

**Tech Stack:** Node.js ≥18（node:test + node:assert，上游测试套件同款）；PowerShell 5.1；7-Zip（NSIS/Electron 安装包解包 + asar 提取）；git。

**Spec:** `docs/superpowers/specs/2026-11-26-dsh-purge-rc5-adaptation-design.md`（同仓 docs/superpowers/specs/ 下；本计划一切取舍以 spec 为准）。

## Global Constraints

- Windows PowerShell 5.1：命令不使用 `&&`，用 `;` 或分步执行。
- 所有文本文件 UTF-8 无 BOM。
- 重型产物（安装包、解包树）只放 `C:\dev\dsh-hosts\`，不进用户目录。
- 禁止写真实安装目录 `C:\Users\Alec\AppData\Local\Programs\DeepSeek Harness`；唯一例外是升级当天由插件自身 apply 流程写入（其自带备份/回滚）。
- TDD 契约（~/.dsh/AGENTS.md）：锚点 pattern 修改是生产行为变更，先 RED 后 GREEN；禁止放宽断言、删用例、mock 被测逻辑。
- 干净基线规则：任何包含 `ALL_PATCHES` 中任一 `marker` 字段的宿主文件不是有效基准。
- 验收口径 = drift-audit 工具输出；无活 Electron 实例时 `selfCheck` 的 `unknown_runtime` 属预期，不算失败。
- 不 git push。commit 步骤需用户批准本计划时一并授权（工作区规则：不主动 commit）。
- sha512 以执行时重新拉取 `https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` 的值为准，不使用文档里转抄的哈希。

## Review Focus

1. **审计匹配器与 apply 匹配器不一致 → 报告说谎。** Task 4 的等价性测试钉住：fixture 内容上，导出的匹配函数与 selfcheck 原逻辑给出相同匹配计数。
2. **pattern 在目标文件出现多次 → apply 语义歧义。** 审计条目必须带 `occurrences`；Task 4 用含重复片段的 fixture 测试 `occurrences > 1` 被如实报告。
3. **rc.3 备份链带历史 marker → 回归断言形同虚设。** Task 3 的 marker 扫描测试钉住：任一 `marker` 命中即该文件弃用。
4. **修好的锚点只匹配 rc.5、破坏 rc.3。** Task 5 每轮修复后重跑审计，断言 rc.3 树 drifted == 0。
5. **版本声明三处不一致（package.json / community.js / README）。** Task 6 测试断言三处都含 `0.2.2-rc.5`。

---

### Task 1: Fork 仓库落地 + 上游预检

**Files:**
- Create: 仓库本体（git init 于 `C:\Users\Alec\Documents\DeepSeekHermesData\闲聊工作区\dsh-purge`，保留已存在的 docs/）
- Read: 上游 https://github.com/kingcharleslzy-ai/dsh-purge tags/releases

**Interfaces:**
- Produces: 本地仓库 = 上游 v1.7.20 + 本仓未跟踪的 docs/；后续任务都在此仓库根执行。

- [ ] **Step 1: 上游预检（spec「开工前必查」）**

```powershell
git ls-remote --tags https://github.com/kingcharleslzy-ai/dsh-purge
```

Expected: 看到 `v1.7.20`。若存在 >1.7.20 的 tag/release 且其说明提到 rc.4/rc.5 适配：**停下，报告用户**，转"取上游适配+本地核对"模式，本计划 Task 5 规模相应缩小。

- [ ] **Step 2: 建仓并检出 v1.7.20（保留现有 docs/）**

```powershell
git init
git remote add upstream https://github.com/kingcharleslzy-ai/dsh-purge
git fetch upstream --depth 1 --tags v1.7.20
git checkout -b fork-rc5 v1.7.20
```

Expected: 工作树为 v1.7.20 源码，docs/superpowers/specs 设计文档仍在（未跟踪）。

- [ ] **Step 3: 与本机已装 1.7.20 核对一致性**

```powershell
fc.exe /b package.json C:\Users\Alec\.dsh\profiles\desktop\node_modules\dsh-purge-community\package.json
```

Expected: 一致（或仅时间戳类差异）；不一致则停下核对哪个是权威源。

- [ ] **Step 4: 基线测试套件跑通**

Run: `node --test test/`
Expected: 全部 PASS（上游 v1.7.20 自带 test/patch-anchors.test.mjs、test/drift-status.test.mjs 等）。有红即停下先解决。

- [ ] **Step 5: Commit 基线**

```powershell
git add -A
git commit -m "chore: fork baseline from kingcharleslzy-ai/dsh-purge v1.7.20"
```

### Task 2: rc.5 安装包获取与解包

**Files:**
- Create: `C:\dev\dsh-hosts\downloads\deepseek-harness-0.2.2-rc.5-win-x64.exe`
- Create: `C:\dev\dsh-hosts\0.2.2-rc.5\app\`（解包后宿主树）

**Interfaces:**
- Consumes: nightly.yml 的 url 与 sha512（执行时拉取）。
- Produces: `C:\dev\dsh-hosts\0.2.2-rc.5\app\` = rc.5 宿主树根（内含 package.json、lib\、node_modules\@deepseek-ai\…）。Task 3/4/5 以此路径消费。

- [ ] **Step 1: 拉 feed 并下载，sha512 校验**

```powershell
$feed = Invoke-WebRequest 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml' -UseBasicParsing
# 解析 version/url/sha512（yaml 手工字段解析即可：version、path、sha512 三行）
Invoke-WebRequest $url -OutFile 'C:\dev\dsh-hosts\downloads\deepseek-harness-0.2.2-rc.5-win-x64.exe'
(Get-FileHash 'C:\dev\dsh-hosts\downloads\deepseek-harness-0.2.2-rc.5-win-x64.exe' -Algorithm SHA512).Hash.ToLower()
```

Expected: 哈希与 feed 的 sha512（base64 解码后 hex 比较）一致。

- [ ] **Step 2: 解 NSIS + 提取 asar**

```powershell
7z x 'C:\dev\dsh-hosts\downloads\deepseek-harness-0.2.2-rc.5-win-x64.exe' -o'C:\dev\dsh-hosts\downloads\rc5-raw'
# 定位 $PLUGINSDIR 或 resources\app.asar 后：
7z x 'C:\dev\dsh-hosts\downloads\rc5-raw\resources\app.asar' -o'C:\dev\dsh-hosts\0.2.2-rc.5\app'
```

若 7z 不能直接解 asar：用 `npx @electron/asar extract <asar> <out>`。Expected: `C:\dev\dsh-hosts\0.2.2-rc.5\app\package.json` 存在且 `"version": "0.2.2-rc.5"`。

### Task 3: rc.3 干净基准

**Files:**
- Create: `scripts/verify-clean-baseline.mjs`（fork 仓库内）
- Create: `C:\dev\dsh-hosts\0.2.2-rc.3\app\`（还原出的干净 rc.3 树）
- Test: `test/verify-clean-baseline.test.mjs`

**Interfaces:**
- Consumes: `ALL_PATCHES`（`lib/patches/index.mjs` 导出，含每条补丁的 `marker` 字段）。
- Produces: `node scripts/verify-clean-baseline.mjs --root <host-tree>`，exit 0 = 干净；输出命中清单。Task 4/5 复用此门槛。

- [ ] **Step 1: 写失败测试**：fixture 目录含一个嵌了 `marker` 字符串（如 `"(allow file-write*)"`）的假宿主文件，断言 `scanTree(root, ALL_PATCHES)` 返回非空命中；另一干净 fixture 断言返回空。

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test test/verify-clean-baseline.test.mjs`，Expected: FAIL（`scanTree` 未定义）。

- [ ] **Step 3: 实现 `scanTree(root, patches) -> string[]`**：遍历 `ALL_PATCHES`，对每条含 `marker` 的补丁，按 asset 解析路径读取文件做字面子串扫描；命中返回 `<patch-id>:<path>`。实现放 `scripts/verify-clean-baseline.mjs` 并导出。

- [ ] **Step 4: 跑测试通过** — Run 同上，Expected: PASS。

- [ ] **Step 5: 从 purge 备份还原 rc.3 树**

备份源：`C:\Users\Alec\.dsh` 下 purge 备份（最新 backupId `2026-11-17T17-11-29-073Z-2deba0b0` 一线；具体备份目录布局以 `lib/restore-backup.js` 的读取逻辑为准）。还原到 `C:\dev\dsh-hosts\0.2.2-rc.3\app\`。

- [ ] **Step 6: 验证干净**

Run: `node scripts/verify-clean-baseline.mjs --root C:\dev\dsh-hosts\0.2.2-rc.3\app`
Expected: exit 0，0 命中。有命中 → 该备份弃用，回退：找留存的 rc.3 安装包归档重解包（同 Task 2 流程）；两者都无 → 报告用户后再议。

### Task 4: drift-audit 审计工具（TDD）

**Files:**
- Create: `scripts/drift-audit.mjs`
- Create: `lib/patch-match.mjs`（从 selfcheck/apply 现逻辑导出的匹配器）
- Test: `test/drift-audit.test.mjs`
- Produces（执行时）: `docs/drift-2026-11-26.json` + `docs/drift-2026-11-26.md`

**Interfaces:**
- Consumes: `ALL_PATCHES`；asset 名 → 宿主树内路径的解析（沿用 `lib/asset-table.js` 同款映射；对 profile 本地/第三方目标走 assets 的当前机器绝对路径）。
- Produces: `runAudit({ patches, trees: [{ id: "rc3", root }, { id: "rc5", root }] }) -> entries[]`，entry 结构：
  `{ patchId, patternIndex, file, rel, status, occurrences }`，
  `status ∈ "matched" | "drifted" | "restructured" | "out-of-tree"`；
  `drifted` 附 `hint`（新文件中与 pattern 最长相邻片段的 60 行上下文），`restructured` 附 `reason`（目标文件不存在 / pattern 任何 ≥40 字符行在归一化空白后仍无命中）。
- CLI: `node scripts/drift-audit.mjs --rc3 <dir> --rc5 <dir> --out docs`。
- 匹配器：`matchCount(content, pattern) -> number`（`lib/patch-match.mjs` 导出，语义与 selfcheck/apply 的定位逻辑逐字一致——先 grep `lib/selfcheck.js`、`lib/reapply.js` 里现有匹配实现，搬移导出，不重写语义）。

- [ ] **Step 1: 写失败测试**（覆盖 Review Focus 1/2）：
  - 等价性：对 3 个真实历史 pattern（#6、#7、#55），fixture 内容上 `matchCount` 与 selfcheck 内联逻辑结果一致；
  - 双重复片段 fixture 断言 `occurrences === 2` 被如实报告；
  - 一组构造 fixture 断言四种 status 分类正确（matched / drifted / restructured / out-of-tree）。

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test test/drift-audit.test.mjs`，Expected: FAIL。

- [ ] **Step 3: 实现**：先抽 `matchCount`（搬移不重写），再实现 `runAudit` 与 CLI。out-of-tree 判定：asset 目标不在给定树根下（profile 本地、第三方插件）→ 单独 `--local` 静态确认模式：对当前机器真实路径跑 `matched` 确认，不进 drift 分类。

- [ ] **Step 4: 跑测试通过** — Expected: PASS。

- [ ] **Step 5: 出首份报告**

Run: `node scripts/drift-audit.mjs --rc3 C:\dev\dsh-hosts\0.2.2-rc.3\app --rc5 C:\dev\dsh-hosts\0.2.2-rc.5\app --out docs`
Expected: 75 条补丁全部有条目；rc3 树上现有 69 个 applied 补丁全部 `matched`（这是 Review Focus 4 的基线证据）；rc5 树的 `drifted` + `restructured` 数量记入报告头部。

### Task 5: 漂移锚点修复（报告驱动，TDD 循环）

**Files:**
- Modify: `lib/patches/*.mjs`（仅漂移条目的 `patterns` / `replacements[].pattern`）
- Create: `docs/fixtures/rc5/<patch-id>-<idx>.txt`（每个漂移锚点一份 rc.5 真实片段）
- Test: `test/patch-anchors.test.mjs`（沿用上游现有结构追加用例）

**Interfaces:**
- Consumes: Task 4 报告的 `drifted`/`restructured` 条目与 `hint`。
- Produces: 修复后 `lib/patches/*.mjs`；`restructured` 补丁的 skipped 清单写入 `docs/drift-2026-11-26.md` 附录（含理由）。

- [ ] **Step 1（每个 drifted 锚点，逐个循环）: 提取 fixture + RED**

从 rc.5 树真实文件提取 `hint` 定位的片段存 `docs/fixtures/rc5/`；追加测试用例：断言**修改后的新 pattern** 匹配该 fixture、**旧 pattern** 不匹配。先跑一次确认 RED（当前源码里还是旧 pattern → 新 pattern 未定义，失败）。

- [ ] **Step 2: 改 pattern 至 GREEN**

改 `lib/patches/*.mjs` 对应 pattern。取舍规则：优先写同时匹配 rc.3 与 rc.5 的 pattern；两版本片段互斥时双 pattern 并列，保持 rc.3 行为不变。Run: `node --test test/patch-anchors.test.mjs`，Expected: PASS。

- [ ] **Step 3: 每轮循环后回归审计（Review Focus 4）**

Run: `node scripts/drift-audit.mjs --rc3 … --rc5 … --out docs`
Expected: rc3 树 drifted == 0（69 applied 无回归）；rc5 树 drifted 逐轮降为 0；剩余 `restructured` 条目逐个标注 skipped 理由，不硬凑。

### Task 6: 版本元数据 bump

**Files:**
- Modify: `package.json`（version → `1.7.21`；`dshReleases` 数组加 `"0.2.2-rc.5"`）
- Modify: `lib/community.js`（`QUALIFIED_HOST_VERSIONS` 加 `"0.2.2-rc.5"`，保留既有项）
- Modify: `README.md` + `README.zh-CN.md`（适配声明行）
- Test: `test/version-metadata.test.mjs`

**Interfaces:**
- Produces: 三处声明一致含 `0.2.2-rc.5`；版本号 `1.7.21`。

- [ ] **Step 1: 写失败测试**：断言 `package.json.version === "1.7.21"`；`dshReleases`、`QUALIFIED_HOST_VERSIONS`、两份 README 各含字符串 `"0.2.2-rc.5"`。（Review Focus 5）

- [ ] **Step 2: RED → 改四处 → GREEN**（`node --test test/version-metadata.test.mjs`）

- [ ] **Step 3: 全套回归**

Run: `node --test test/`
Expected: 全 PASS（含上游原有用例）。

- [ ] **Step 4: Commit**

```powershell
git add lib scripts test docs package.json README.md README.zh-CN.md
git commit -m "feat: adapt anchors and metadata for DSH 0.2.2-rc.5 (1.7.21)"
```

### Task 7: 打包 + 装进 live profile + 通道钉扎（需用户在场确认）

**Files:**
- Create: `dist/dsh-purge-community-1.7.21.tgz`（`npm pack` 产物，放 `C:\dev\dsh-hosts\` 或仓库 dist/）
- Modify: `C:\Users\Alec\.dsh\profiles\desktop\node_modules\dsh-purge-community\`（经插件自身 update-install 链安装，非手工拷贝——`lib/community.js:722` 有 Installed-plugin mismatch 对账）
- Modify: `C:\Users\Alec\.dsh\dsh-purge\channel.json`（`pin` 指向本地 fork，用户已拍板钉住）

**Interfaces:**
- Consumes: Task 6 的 1.7.21 仓库。
- Produces: profile 内生效 1.7.21；`installed-rev` 显示 `apply:1.7.21`；rc.3 宿主上重 apply 后状态仍 69/75 applied、0 drift。

- [ ] **Step 1: 打包** — Run: `npm pack`；Expected: tarball 内 `package/version` 为 1.7.21。
- [ ] **Step 2: 经 update-install 链装入 profile**（用插件自身安装入口指向本地 tarball；具体命令以其 `scripts/install.ps1` / update 流程为准）；Expected: 安装完成、对账无 mismatch 报错。**执行前向用户口头确认一次。**
- [ ] **Step 3: 钉通道** — `channel.json` 写 `{"channel":"stable","pin":"<本地fork路径或tag>"}`；Expected: 插件 check/update 不再指向上游 releases。
- [ ] **Step 4: rc.3 上真机回归** — Purge 状态页重「应用」→ `/purge` 状态确认 69/75 applied、0 pending、0 drift（走插件备份流程，可回滚）。

### Task 8: 升级当天 runbook + 收尾

**Files:**
- Create: `docs/upgrade-day-rc5.md`

**Interfaces:**
- Consumes: Task 5 的 skipped 附录、Task 7 的安装态。
- Produces: 一页升级流程：宿主设置页手动升级到 rc.5（宿主 autoDownload=false，无自动升级压力）→ Purge 状态页「应用」→ 预期状态（哪些补丁 applied / 哪些 skipped）→ 异常时回滚路径（备份还原 + channel 解钉）。附最终审计报告链接与全套 check 清单结果。

- [ ] **Step 1: 写 runbook 文档**
- [ ] **Step 2: 跑全套 `scripts/check-*` 与 `node --test test/` 收尾确认**
- [ ] **Step 3: Commit 收尾** — `git commit -m "docs: rc.5 upgrade-day runbook and drift report"`
