# Spec Delta

## Purpose

定义 agent 消费面共享资产（当前为 pk 技能文档）的单一源组织、版本单源与双实现内嵌一致性，以及技能向各 agent 目录的安装落盘行为。

## ADDED Requirements

### Requirement: 技能资产单一源

pk 技能文档 SHALL 以仓库根 `agent-plugins/skills/<skill>/` 为唯一源，源目录结构与技能落盘结构一致（`SKILL.md` + `references/`），仓内不存在其他拷贝。

#### Scenario: 源结构与落盘结构对齐

- **WHEN** 查看 `agent-plugins/skills/pokemon-choose-you/` 目录
- **THEN** 含 `SKILL.md`（frontmatter 带 `name` 与 `version`）与 `references/commands.md`、`references/suggest-workflow.md`，与安装到 agent 目录后的文件集合逐一对应当

#### Scenario: 原位置删除

- **WHEN** 在 `src-tauri/skills/` 查找技能文档
- **THEN** 该目录不存在，Rust 与 TS 消费方均直接引用 `agent-plugins/skills/` 下的文件

### Requirement: 双实现内嵌一致性

Rust 消费方（`include_str!` 编译期内嵌）与 TS 消费方（构建工具 raw 内嵌）SHALL 从同一批源文件取得技能内容，双侧各自的测试 SHALL 断言内嵌内容与磁盘源文件一致，防止单边复制漂移。

#### Scenario: Rust 内嵌与磁盘文件字节一致

- **WHEN** 运行 Rust 侧技能同源测试
- **THEN** 内嵌的 SKILL.md 与 references 内容与 `agent-plugins/skills/pokemon-choose-you/` 磁盘文件字节相等

#### Scenario: TS 内嵌与磁盘文件字节一致

- **WHEN** 运行 dsh-plugin 侧技能同源测试
- **THEN** raw 内嵌的技能内容与同一批磁盘文件字节相等

### Requirement: 技能版本单源

技能版本唯一源 SHALL 为 `SKILL.md` frontmatter 的 `version` 字段；Rust 侧版本取值 MUST 由解析内嵌 MD 的 frontmatter 得出，不得维护独立的人工常量镜像；安装时的版本对比（previousVersion/updated）与 `pk doctor` 的旧版检测 SHALL 基于该解析值。

#### Scenario: frontmatter 升版后双端感知

- **WHEN** `SKILL.md` frontmatter 的 `version` 提升且环境已装旧版技能
- **THEN** `pk skill install` 报告 `previousVersion` 为旧值、`version` 为新值，`pk doctor` 检出旧版并给出安装建议

#### Scenario: Rust 不再有人工版本常量

- **WHEN** 检查 Rust 技能模块
- **THEN** 不存在与 frontmatter 人工同步的 `SKILL_VERSION` 字符串常量，版本值均来自 frontmatter 解析

### Requirement: 技能安装落盘

`pk skill install <agent>` SHALL 将技能安装到对应 agent 的全局技能目录并保持幂等：目录映射为 claude-code → `~/.claude/skills/`、opencode → `~/.config/opencode/skill/`、pi → `~/.pi/agent/skills/`、dsh → `~/.dsh/skills/`，技能本体一律落 `<根>/pokemon-choose-you/`（`SKILL.md` + `references/`）；TS 实现与 Rust 实现的落盘产物 SHALL 一致，且 TS 实现不承担 SSH 远端安装分支。

#### Scenario: 安装落盘结构

- **WHEN** 执行 `pk skill install pi`
- **THEN** `~/.pi/agent/skills/pokemon-choose-you/` 下出现 `SKILL.md` 与 `references/` 两级文件，内容与单一源一致

#### Scenario: 重复安装幂等

- **WHEN** 同一 agent 连续执行两次安装且版本未变
- **THEN** 第二次不产生内容变化，报告 `installed` 为 true 且 `previousVersion` 等于当前版本
