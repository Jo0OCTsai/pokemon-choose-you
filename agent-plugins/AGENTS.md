# agent-plugins/ agent 消费面资产单一源约定

> Rust（主应用 `src-tauri/`）与 TS（`dsh-plugin/`）双实现共享的 agent 消费面资产目录。
> 当前只承载 `skills/`（pk 技能文档）；后续 agent 相关配置扩展落本目录，不进单实现目录。

## 不变量与红线

- **单一源，禁止复制**：`skills/pokemon-choose-you/`（`SKILL.md` + `references/`）是技能文档
  唯一源——不得在 `src-tauri/` 或 `dsh-plugin/` 内留拷贝。源目录结构与技能落盘结构
  （`<agent 根>/pokemon-choose-you/`）一致，无文件名映射。
- **双实现编译期内嵌**：Rust `include_str!`（`src-tauri/src/skills.rs`）与 TS vite `?raw`
  （`dsh-plugin/src/host/skills-raw.ts`）消费同一批文件；双侧各自测试断言内嵌与磁盘
  字节一致（Rust `embedded_skill_matches_agent_plugins_source` / TS `skills.spec.ts`）。
- **版本唯一源 = SKILL.md frontmatter 的 `version`**：两实现均解析该字段，不设人工常量
  镜像（Rust `SKILL_VERSION` 为 LazyLock 解析）。技能内容演进 = 改 md 并 bump frontmatter
  version，无第二处要同步。
- **内容基准**：pk 命令签名/返回结构变更必须同步本目录技能文档（`references/commands.md`
  全参数表）；与 `pk help --json` 的 COMMAND_INDEX 人工互镜。

## 命令速查

- 版本对比链路验证：`cargo test --lib skills`（Rust）/ `pnpm --filter dsh-plugin vitest run __tests__/skills.spec.ts`（TS）
