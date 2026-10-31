# Proposal

## Why

dsh-plugin 目前为了 remote 开通场景 vendor 一个 2.8MB 的 Rust pk 二进制：构建链被 cargo 交叉编译绑死（`prepare-pk-cli.mjs` → `build.mjs` 拷贝）、每平台分发体积多一份产物，与「dsh-plugin 单次构建即具备全部能力、业务核心零平台依赖」的插件形态目标矛盾。同时 pk 的技能文档虽已是「单一源、双消费」（Rust `include_str!` + vite `?raw`），但源文件放在 `src-tauri/skills/` 下，TS 侧跨模块引用 Rust 目录的资产，归属错位；后续 agent 相关配置还将继续增加，需要中立的家。

## What Changes

- 新增仓库根 `agent-plugins/` 目录：`skills/pokemon-choose-you/`（`SKILL.md` + `references/`，由 `src-tauri/skills/` `git mv` 而来，源结构与技能落盘结构对齐），作为 agent 消费面共享资产的单一源；`src-tauri/skills/` 删除。
- SKILL_VERSION 单源彻底化：Rust 侧人工常量镜像（`skills.rs` `SKILL_VERSION = "9"`）改为运行时解析内嵌 MD 的 frontmatter（LazyLock），md frontmatter 成为唯一版本源；TS 侧已是解析实现，不变。
- dsh-plugin 新增顶层 `src/pk/`：TS 实现全量 pk 命令面（task/note/log/session/dispatch/suggest/skill/remote/category/tag/context/doctor/init-db/help/version，含 remote 家族 `setup`/`shim`/`__ssh_entry`），数据面复用 `src/host/domain/` + `src/host/storage/`，**pk bundle 零 dsh 平台面依赖**；remote 的 ssh 编排在 pk 内自持（child_process 调 ssh/ssh-keygen/ssh-keyscan）。
- 分发形态：esbuild 打包单文件 `dist/pk.mjs`（`#!/usr/bin/env node`），落位 `~/.choose-you/bin/pk`（Windows 落位 `pk.cmd` 包装）；`dsh-plugin/vendor/` 目录与 `build.mjs` 的 Rust 二进制拷贝段删除——**dsh-plugin 单次 build 即分发全部能力，不再依赖 Rust 工具链**。
- contracts 新增 CLI 信封契约组：每命令一场景（输入 → 期望 stdout JSON），Rust oracle 生成 fixtures、TS pk 回放比对，锁双实现 CLI 输出一致性；`version` 与时间戳类字段沿用归一化手段。
- 决策留痕：新增 ADR-0006（远程开通从「Rust 单源」改为「按宿主双实现」），ADR-0003 头部加 superseded 注记指向 0006；桌面 Tauri 链路（sidecar `binaries/pk` + `setup_deployment_pk`）**零改动**。
- **BREAKING**：dsh-plugin 构建产物不再包含 `vendor/pk-<triple>`；落位的 pk 由原生二进制变为 node 脚本（目标环境需 PATH 可见 node——与 dsh 宿主自身运行前提一致，实际不新增要求）。

## Capabilities

### New Capabilities

- `agent-plugins`: agent 消费面共享资产（当前为技能文档）的单一源组织、版本单源（md frontmatter）与 Rust/TS 双实现内嵌一致性不变量。
- `pk-cli`: pk 命令面的对外契约——命令集、stdout JSON 信封、退出码、环境变量（`PK_DB`/`PK_LOG_FILE`/`PK_DISPATCH_TASK`/`PK_SSH_BIN`）、remote 家族安全模型（forced-command 入口校验）、双实现（Rust/TS）行为一致性，以及 dsh 场景下 pk 的落位与分发形态。

### Modified Capabilities

（无——主规格库当前为空，本变更全部为新建能力。）

## Impact

- **代码**：`src-tauri/src/skills.rs`（内嵌路径 + 版本解析化）；`dsh-plugin/`（新 `src/pk/`、`build.mjs`、`src/host/remote/pkLocal.ts` 落位、`src/host/dsh/pkSetup.ts` 调用目标、`package.json` files、`src/host/skills-raw.ts` 与 `domain/skills.ts` 路径）；`contracts/`（新 `scenarios/cli_envelope/` + `fixtures/cli_envelope/`）。
- **不动**：桌面 Tauri 的 sidecar 分发链（`tauri.conf.json` externalBin、`prepare-pk-cli.mjs`、`remote_pk.rs` 桌面命令）、`bin/pk` Rust CLI 本体（仅 skills.rs 消费的 md 路径与版本解析变化）。
- **文档**：根 `AGENTS.md` 模块表补 `agent-plugins/`；`dsh-plugin/AGENTS.md` 与 `contracts/AGENTS.md` 对应条目；`docs/decisions/0006-*.md` 新增 + 0003 注记。
- **依赖**：零新增运行时依赖（esbuild 既有）；供应链四查（npm audit / cargo deny / gitleaks / jscpd）口径不变。
- **风险面**：双实现行为漂移由 CLI 信封契约组兜底；Windows 分支（icacls 权限、路径转义、pk.cmd）随全量对齐一并覆盖。
