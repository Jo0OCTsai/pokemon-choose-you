# pokemon-choose-you 模块约定（载体：macos）

> 本文件被 agent 会话自动加载（跨 agent 通用；Claude Code 2.x 原生 fallback 读取）：写「不变量与红线」，不写流水账。
> macos 载体与 devcontainer 载体的差异：无 `.devcontainer/` 容器件（devcontainer.json / Dockerfile /
> features / lifecycle 脚本；`stack.json` 仅作栈与载体单源保留）；开发环境即 mac 宿主。**依赖安装无容器
> lifecycle 钩子自动执行——首次手动跑 `pnpm install`（prepare 脚本自动安装 lefthook 钩子），之后 agent
> 首跑/按需同步**。

## 运行环境（先自识别）

- 载体：`macos`（mac 宿主直跑，仅限 mac 宿主——平台红线在 apply 侧强制；无路径位置红线）
- 载体声明：`.devcontainer/stack.json` 顶层 `carrier` 字段（互斥四选一；换载体走
  `apply --carrier <新载体> --migrate-carrier`，不要手改后混入容器件）
- 栈与命令单源：`.devcontainer/stack.json` `services[]`（lint / 测试 / dev server 命令一律读它，勿另立）

## 质量门禁（与 devcontainer 载体同源）

- 交付前：`CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh`（Stop hook 同口径；按 stack.json 路由）
- 提交前：pre-commit（`lefthook.yml` 挂 lint-gate；commit-msg 跑 commitlint）
- macos 载体：lint-gate / pre-commit 在宿主 shell 执行（依赖工具经 host-bootstrap dev-tools 模块供给——
  `host-setup.sh check` 体检；python3 来自 Xcode CLT）

## 模块不变量

- `src/` —— 前端 Vue 3（views / stores / composables）：composable 必须配套 `__tests__/useXxx.spec.ts`、
  store 状态契约与 defineExpose 契约——详见 `src/AGENTS.md`
- `src-tauri/` —— Rust 后端：SQLite 迁移只追加不修改（`db.rs`）；`bin/pk/` 是 agent 消费面，命令签名/
  返回结构变更必须同步 `src-tauri/skills/` 技能文档（`SKILL_VERSION` 随内容演进）；AI 判定只走 tools
  模式（`pk context` + `pk suggest batch`，text 解析模式已下线）

## 命令速查

- 依赖同步：`pnpm install`（**首次手动执行**，无容器钩子代跑；prepare 自动装 lefthook 钩子）
- lint 全量：`CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh`
- 质量棘轮：日常 `python3 .devcontainer/scripts/quality_ratchet_check.py`（复杂度基线只准收缩——新增违规即红；改善后 `--prune` 回写收缩；基线勿手改数值）
- 测试 / dev server：以 stack.json `test_cmd` / `dev_cmd` 为单源（前端 `pnpm test` / `pnpm dev`；`src-tauri` 内 `cargo test`）

## 禁止事项

- 不引入 `.devcontainer/` 容器件（devcontainer.json / Dockerfile / features 等）——本项目载体已声明，
  混入两套开发环境定义会被 apply 互斥保护拒绝
