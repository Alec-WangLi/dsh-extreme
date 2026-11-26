# 升级日 Runbook — DSH Desktop 0.2.2-rc.3 → 0.2.2-rc.5（及后续版本）

> 适配版本：`dsh-purge-community` **1.7.21**（fork `fork-rc5` 分支，commits 64613e9…7de33eb）
> 离线审计结论：rc.3 与 rc.5 对全部 88 条补丁**逐行等价、零新增漂移**（`docs/drift-2026-11-26.md`），升级当天预期**无需任何锚点改动**。

## 0. 前提状态（2026-11-26 已完成）

- live profile（desktop）已装 1.7.21：`~\.dsh\profiles\desktop\node_modules\dsh-purge-community`（依赖 spec 指向 `~\.dsh\dsh-purge-community\pkgs\b20c14de…\dsh-purge-community-1.7.21.tgz`，自包含）。
- 更新通道已钉住：`~\.dsh\dsh-purge\channel.json` = `{"channel":"stable","pin":"v1.7.21"}` —— auto-install 走到 `pinned-or-upstream` 直接 skip，上游新 release 不会自动覆盖。
- 安装备份：`2026-11-26T10-29-03-471Z-a82acefb`（pnpm 前 1.7.20 状态）。
- 宿主当前 rc.3，66 个 `.dshpurge.bak` sidecar 在盘；宿主补丁仍是 1.7.20 写入的那批（功能等价，重应用后 marker 刷新为 1.7.21 口径）。

## 1. 升级当天流程

### 1.1 宿主升级后先看状态（不要先点应用）

```powershell
# 确认宿主真的升到 rc.5
(Get-Content "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app\package.json" | ConvertFrom-Json).version

# 只读体检：Desktop carrier CLI 是唯一正确入口
$env:PURGE_DSH_CLI = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
$env:DSH_PROFILE = "desktop"
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge-community\bin\community.js" status
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge-community\bin\community.js" diagnose
```

判定：
- `sealed_host: true` / `asar_still_sealed` → 宿主重装覆盖了解包布局，**正常**，下一步重应用即可。
- diagnose 若报新锚点漂移（rc.5 审计结论说不应发生）：先跑 `scripts/drift-audit.mjs` 双树审计复核，再决定是重锚（`reanchor apply`）还是回 fork 修锚——**不硬凑、不放宽 marker**。

### 1.2 应用 + 重启（人工操作）

1. 左侧栏 Purge → 状态 → 点「应用」（写入前自动备份，幂等）。
2. **退出并重开 DSH Desktop**（补丁重启后才加载）。
3. 新宿主上首次应用预期：86/88 applied + 2 informational（restore 型补丁 #2/#3 的官方 marker 天然在场），0 drifted。

### 1.3 验收

```powershell
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge-community\bin\community.js" selfcheck --json
```

预期：24 层 ok + 「当前 profile 的权限选择」层按会话实际权限显示（workspace-write/ask 会标 broken，属提示非故障，注脚自带"若有意的设置，无需调整"）。
运行时链路验证：面板或 CLI `probe new` → 任意对话回显 nonce。

### 1.4 出问题时回退

- 插件回滚：`rollback 2026-11-26T10-29-03-471Z-a82acefb`（回到 1.7.20）；再早就往 `backups/` 里找更早 id。
- 只撤宿主补丁：`revert`。
- 宿主本身回退：官方 feed 仍提供 rc.3 安装包（`https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.3-win-x64.exe`），重装后点一次「应用」即可回到当前等价状态。

## 2. 后续版本（0.2.3 / rc.6…）重复适配流程

pin 已钉住，上游新版不会自动进 live。适配新宿主版本时：

1. 官方 feed 拉安装包 + sha512 校验，7z 解 NSIS + `npx @electron/asar extract` 到 `C:\dev\dsh-hosts\<ver>\resources\app`（**必须含 `resources\` 层**，否则 desktopResourcesForHost 正则不认）。
2. 双树审计：`node scripts/drift-audit.mjs --tree rc3=<旧树> --tree new=<新树>`（或以新树对上一版树）。
3. drifted/restructured=0 → 只做元数据 bump（TDD `test/version-metadata.test.mjs` 红→绿，同任务把新测试加进 `package.json scripts.test` 清单）。
4. 有漂移 → 按漂移行修 `lib/patches/*.mjs` 锚点，`docs/fixtures/` 钉真实片段，审计归零后 commit。
5. `npm pack` → `purge-community migrate <tgz>`（PURGE_DSH_CLI 指 dsh-desktop-host carrier）→ 更新 `channel.json` pin 到新 tag → 升级日按本 runbook 重应用。

## 3. 上游修复搬运策略

上游 kingcharleslzy-ai 出 >1.7.20 的修复时：fork 里 `git fetch upstream && cherry-pick`，跑全套 `npm test` + `check:docs`，过审后 bump 我们自己的补丁位版本号再装；pin 保持指向自维护 tag，不切回上游浮动通道。
