# dsh-purge fork：适配 DSH Desktop 0.2.2-rc.5 — 设计文档

日期：2026-11-26
状态：已批准（用户 2026-11-26 拍板：更新通道钉住本地 fork，见「待用户决定」）；进入 writing-plans

## 意图与动因

DeepSeek Harness Desktop 的 nightly 更新通道已发布 **0.2.2-rc.5**（2026-11-18，staging 100%），本机现为 0.2.2-rc.3，随时会被自动升级。已装的插件 **dsh-purge-community 1.7.20**（源仓库 [kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge)）的补丁锚点绑定宿主源码字面片段，宿主升级后锚点漂移、补丁大面积失效。

目的：宿主升级前，fork 仓库并把锚点适配到 rc.5，升级当天插件直接可用；同时从"依赖别人 fork"转为"自己养一份"。

## 事实基础（本机侦察结果）

- 宿主：0.2.2-rc.3（`resources\app\package.json`，name=@deepseek-ai/dsh-desktop）
- 更新通道：generic provider，`https://download.deepseek.com/dsh-desk/feeds/win-x64/`，channel nightly；`nightly.yml` 当前指向 0.2.2-rc.5（sha512 已取得，安装包约 286 MB）
- 插件：1.7.20，装在 `C:\Users\Alec\.dsh\profiles\desktop\node_modules\dsh-purge-community`；状态 69/75 applied / 0 pending；备份机制完好
- 补丁定义：`lib/patches/*.mjs`（code / engine / prompt / new-tools / opt-in / stability），锚点为宿主源码字面 pattern + replacement
- 应急重锚机制：`$DSH_HOME/dsh-purge/anchor-overrides.json` 可不改源码覆盖某补丁 pattern（见 `lib/anchors.js`）
- 自检工具链：`lib/selfcheck.js` + `scripts/check-*` 一整套运行时校验
- 上游"官方社区版" [Dawnforge3827/dsh-purge-Community](https://github.com/Dawnforge3827/dsh-purge-Community) 停在 1.6.60 / 0.2.1-rc.3，已放弃作为基线

## 方案取舍

- **A（选定）**：以本机在用的 kingcharleslzy-ai/dsh-purge 1.7.20 为基线 fork，只修 rc.3→rc.5 的漂移。69 个补丁已在 rc.3 真机验证，漂移面最小。
- ~~B：以 Dawnforge3827 社区仓为基线~~ — 需跨 0.2.1→0.2.2 两个宿主版本修锚点 + 搬运 40+ 兼容补丁，双倍工作量；只有"接管社区名号对外发版"才值得，当前无此需求。
- ~~C：只出 rc.5 体检报告不 fork~~ — 把活推迟，且与"自己养一份"的目标相悖。

## 目标

1. Fork 基线代码到本地仓库 `闲聊工作区\dsh-purge\`，保留 MIT 与原作者署名（小杨 / YuJunZhiXue 及 kingcharleslzy-ai）。
2. 全部锚点在 0.2.2-rc.5 宿主源码上匹配成功；确实无法锚定的补丁如实标记 skipped 并给出理由，不硬凑。
3. 版本声明更新为"适配 0.2.2-rc.5"（兼容行保留 rc.3 验证记录）。
4. 升级当天的落地路径走通：宿主升级 → purge apply（自动备份）→ selfcheck 全绿。

## 非目标

- 不新增功能、不改提示词内容、不动 6 个 tuning 关掉的补丁（#18 #19 #35 #54 #76 #80）的开关状态。
- 不接管社区版名号，不对外发版、不打 tag 推 npm。
- 不提前把本机 rc.3 真安装升级到 rc.5——升级时机由用户自己定。

## 反目标（做砸了的样子）

- 为让自检变绿而放宽锚点校验、删补丁、跳过用例。
- 在真实运行的 rc.3 安装目录上做实验（所有 diff / 测试都在解包副本上）。
- 静默吞掉"宿主重构导致某补丁无从谈起"的事实。

## 约束

- **TDD 契约**：漂移锚点的 pattern 修改是生产行为变更。每个漂移锚点先写失败测试（旧 pattern 在 rc.5 源码上不匹配 = RED），再改 pattern 至通过（GREEN）；rc.3 回归断言不被破坏。目标重构类补丁的 skipped 决定同样先落测试证据。
- Windows + PowerShell 5.1 环境：不使用 `&&`；所有文本 UTF-8 无 BOM。
- 重型产物（安装包、解包副本）放 `C:\dev\dsh-hosts\`，不塞用户目录。
- 漂移的锚点改进 fork 源码；`anchor-overrides.json` 只作为升级当天的应急通道，不是本次的交付方式。
- 不自动重启宿主；不 git commit / push（除非用户明说）。

## 设计（分四阶段）

### 阶段 1 — 获取 rc.5 源码
1. 下载 `deepseek-harness-0.2.2-rc.5-win-x64.exe`（URL 与 sha512 来自 nightly.yml）到 `C:\dev\dsh-hosts\downloads\`，校验 sha512。
2. 解包安装包（7z 解 NSIS/Electron 包）取出 `resources\app\`，再解 asar，落盘 `C:\dev\dsh-hosts\0.2.2-rc.5\`。
3. **rc.3 干净基准**：现安装目录已被 69 个补丁写入 marker（`main.js.dshpurge.bak` 等旁证），**不能**直接当基准——每个已应用补丁都会被误判为漂移。基准来源：优先从 purge 备份还原 rc.3 到 `C:\dev\dsh-hosts\0.2.2-rc.3\`，**逐文件验证无补丁 marker**（1.6.x→1.7.x 多轮 apply 的备份链可能带历史 marker，不干净的备份条目弃用）；备份不可用时回退到留存的 rc.3 安装包归档重解包。
4. 插件自带 `lib/extract-asar.js` / `lib/windows-asar-handoff.js` 含现成解包逻辑，优先复用。

### 阶段 2 — 漂移审计
1. 从 `lib/patches/*.mjs` 提取全部补丁表：id、目标文件、pattern、replacement。
2. **审计范围分层**（补丁目标不全在宿主源码里）：
   - **宿主树目标**（`resources\app` 内，含宿主自带的 shipped presets）：纳入 rc.3→rc.5 漂移审计的主体，逐 pattern 两版匹配。
   - **profile 本地目标**（`~\.dsh\.agent-presets\` 等用户/preset 文件）：宿主升级不会移动它们，只做"当前本机文件上仍匹配"的静态确认，不进 rc.5 drift 范围。
   - **第三方插件目标**（如 `profiles\web\node_modules\dsh-compaction-instant`）：独立更新、与宿主 rc 无关，同上只做静态确认。
3. 对两类源码（宿主树 rc.3 / rc.5）逐 pattern 匹配，产出三类结果：**仍匹配** / **漂移**（在 rc.5 中能定位到对应新片段）/ **目标重构**（文件或逻辑消失/重写）。
4. 产出 drift 报告存入 `docs/`，新旧片段对照。

### 阶段 3 — 修锚点（TDD）
1. 每个漂移锚点：RED（旧 pattern 对 rc.5 断言失败）→ 改 `lib/patches/*.mjs` 中 pattern → GREEN（新 pattern 匹配 rc.5；按补丁语义尽量同时兼容 rc.3）。
2. TDD 落点用上游现成测试套件：`test/patch-anchors.test.mjs`、`test/anchors.test.mjs`、`test/drift-status.test.mjs` 等，不另起炉灶。
3. 跑插件自带 `scripts/check-*` 与 selfcheck 校验逻辑。
4. 目标重构类补丁：标记 skipped + 理由写入 drift 报告，不硬凑锚点。

### 阶段 4 — fork 落地
1. 从 kingcharleslzy-ai/dsh-purge 拉 v1.7.20 源码建仓 `闲聊工作区\dsh-purge\`，与本机已装 1.7.20 包核对一致性。
2. 版本号按仓库惯例 bump（1.7.21 量级），README 声明适配 0.2.2-rc.5。
3. **版本元数据同步**：`lib/community.js` 的 `QUALIFIED_HOST_VERSIONS` 与 `package.json` 的 `dshReleases` 加上 0.2.2-rc.5（当前缺 rc.5，但 unqualified 只 warn 不阻塞，仍应补齐）。
4. **进 live profile 的方式**：不打补丁式的手工拷目录——`lib/community.js:722` 有 "Installed plugin mismatch" 对账，手工替换可能触发版本校验报错。走插件自身的 update 安装链（version-history 显示其一贯从 release tarball 装），把 fork 打成 tarball、以本地路径或 GitHub release（用户定）为源安装到 `profiles\desktop\node_modules\dsh-purge-community`。
5. **更新通道钉扎**：fork 装进 profile 后，插件的 check/update 指向谁（上游 kingcharleslzy-ai releases vs 钉住本地 fork）——待用户拍板，见"待用户决定"。
6. 升级当天流程文档：宿主升级（设置页手动确认，宿主 `autoDownload=false`，无自动升级赛跑压力）→ Purge 状态页『应用』→ 自检确认。

## 开工前必查（防重复劳动）

上游 kingcharleslzy-ai/dsh-purge 是否已发布 rc.5 适配（release/tag/commit）？若有：改为"取其适配 + 本地核对"而非自己重修锚点；若其适配有遗漏仍按阶段 3 补。此项在阶段 2 之前执行。

## 验证（验收标准）

- rc.5 解包源码上全部**宿主树**锚点匹配测试绿（或明确 skipped 且有理由记录）；profile 本地/第三方插件目标在当前本机文件上仍匹配。
- rc.3 上无回归：现有 69 applied 补丁的锚点在**干净 rc.3 基准**（见阶段 1.3，非被补丁过的现安装目录）仍匹配。
- 插件 check 脚本套件通过。
- **验收口径**：解包副本上的验收证据 = drift/pattern 审计工具输出（0 pending / 0 drift）。`selfCheck` 状态机需要活着的 Electron 实例，无运行实例时 verdict 为 `unknown_runtime` 属预期，**不算失败**；终态 ok 在升级当天由真宿主上的自检给出。

## 待用户决定（builder check 提出，只有用户能拍板）

**fork 装进 live profile 后，更新通道钉在哪？**
- 现状：`channel.json` 为 `{"channel":"stable","pin":""}`——pin 机制存在未启用，插件的 check/update 默认看上游 kingcharleslzy-ai 的 releases。
- 选项 1：**钉住本地 fork**（`channel.json` 设 pin / 源指向自己仓库）。上游发 1.7.22 不会静默覆盖本地适配；代价是上游后续修复要自己手动搬。
- 选项 2：**继续跟上游**。上游若也发 rc.5 适配，一键升级省事；代价是上游任何一次 release 都可能覆盖掉本地未回馈的改动。
- 推荐：选项 1（钉住）。理由与"自己养一份"的目标一致；上游修复值得搬时再手动搬。
- **已定（用户，2026-11-26）：选项 1，钉住本地 fork。**

## 遗留给实现者的决定

- 版本号 bump 幅度（1.7.21 vs 1.8.0），按仓库 tag 惯例定。
- 是否顺带验证 rc.4（若 feed/归档可取且成本低则一并声明，取不到就只管 rc.5）。
- GitHub 远端未定：先本地养仓，远端地址留空位，用户提供用户名后再推。
- drift 报告与设计文档同放 `docs/` 的具体文件名。
