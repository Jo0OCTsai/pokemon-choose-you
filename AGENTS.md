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

## 分支与 Worktree 约定

- 分支模型：短生命周期 feature 分支（GitHub Flow 风格），命名 `<type>/<desc>`（feat / fix / chore…）；
  合并用 squash 保线性历史；main 分支保护（require PR + status checks + linear history）为平台侧手动配置
- 提交信息：Conventional Commits（`feat(scope): xxx`；lefthook commit-msg 跑 commitlint 本地校验 + CI 兜底）
- 功能开发隔离用 worktree：用 `create-repo-worktree` 技能（放置分流 sibling/容器 `.worktrees/`、
  运行时隔离、清理规范见该技能，此处不复制）；服务与栈配置单源 = `.devcontainer/stack.json` `services[]`
- worktree 并行端口策略：与主仓 dev server（Tauri/vite 1420）错开（固定偏移 + strictPort，
  见 create-repo-worktree「运行时隔离」节）

## 模块不变量

- `src/` —— 前端 Vue 3（views / stores / composables）：composable 必须配套 `__tests__/useXxx.spec.ts`、
  store 状态契约与 defineExpose 契约——详见 `src/AGENTS.md`
- `src-tauri/` —— Rust 后端：SQLite 迁移只追加不修改（`db.rs`）；`bin/pk/` 是 agent 消费面，命令签名/
  返回结构变更必须同步 `src-tauri/skills/` 技能文档（`SKILL_VERSION` 随内容演进）；AI 判定只走 tools
  模式（`pk context` + `pk suggest batch`，text 解析模式已下线）

## 命令速查

- 依赖同步：`pnpm install`（**首次手动执行**，无容器钩子代跑；prepare 自动装 lefthook 钩子）
- lint 全量：`CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh`
- 质量棘轮：日常 `python3 .devcontainer/scripts/quality_ratchet_check.py`（①复杂度基线只准收缩——新增违规即红；②覆盖率地板；③代码卫生 todo/unsafe/missing_docs 计数超基线即红——unsafe 存量 4 处全在 input.rs macOS FFI、missing_docs 存量 271 渐进清理见 docs/debt.md；改善后 `--prune` 回写收缩；基线勿手改数值）
- 测试 / dev server：以 stack.json `test_cmd` / `dev_cmd` 为单源（前端 `pnpm test` / `pnpm dev`；`src-tauri` 验收口径 `cargo llvm-cov` 带覆盖率门禁，日常快速路径 `cargo test`）
- 覆盖率门禁（地板已被棘轮锁定，下调即红）：前端 `pnpm test:coverage`（阈值 = vite.config.ts `coverage.thresholds` 四维同值；api.ts invoke 薄封装与 i18n 字典不入口径——真实通路由 E2E 覆盖）；Rust `pnpm test:rust:coverage`（`--fail-under-lines`；input/tray/shortcuts/lib/main 等 GUI 胶水 `--ignore-filename-regex` 不入口径；首次需 `rustup component add llvm-tools-preview` + `cargo install cargo-llvm-cov`，产物 lcov + html 落 `src-tauri/target/llvm-cov/` 独立 target 目录不污染日常编译缓存）
- 供应链与重复率：`pnpm audit:npm`（npm 依赖漏洞，显式官方 registry——本地镜像源无 audit 端点）；`cargo deny check`（Rust 依赖 license/漏洞/ban，配置 = `src-tauri/deny.toml`）；`gitleaks detect`（秘密扫描，豁免 = `.gitleaks.toml`，pre-commit 挂 `gitleaks protect --staged` 本机未装自动跳过、CI 兜底）；`pnpm check:duplicates`（jscpd 重复率 >2.5% 即红）——四者 CI 供应链 job 全跑

## 禁止事项

- 不引入 `.devcontainer/` 容器件（devcontainer.json / Dockerfile / features 等）——本项目载体已声明，
  混入两套开发环境定义会被 apply 互斥保护拒绝
