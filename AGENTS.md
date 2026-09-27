# <项目名> 模块约定（载体：<wsl | native | macos>）

> apply-dev-env 生成骨架（`templates/carrier/AGENTS.md`）——按项目实况填充后放**项目根**。
> 本文件被 agent 会话自动加载（跨 agent 通用；Claude Code 2.x 原生 fallback 读取）：写「不变量与红线」，不写流水账。
> wsl / native / macos 载体与 devcontainer 载体的差异：无 `.devcontainer/` 容器件（无 devcontainer.json /
> Dockerfile / features / lifecycle 脚本）；开发环境即本机（WSL / Windows 原生 / macOS 宿主）；**依赖安装无容器
> lifecycle 钩子自动执行——首次手动跑 `make sync`（或等价命令），之后 agent 首跑/按需同步**。

## 运行环境（先自识别）

- 载体：`wsl`（项目位于 WSL 文件系统 `~/`，**严禁 `/mnt/*`**——跨文件系统 I/O 显著变慢且 inotify 失效）
  或 `native`（项目位于 Windows 文件系统，**严禁 `\\wsl$` 路径**）
  或 `macos`（mac 宿主直跑，仅限 mac 宿主——平台红线在 apply 侧强制；无路径位置红线）
- 载体声明：`.devcontainer/stack.json` 顶层 `carrier` 字段（互斥四选一；换载体走
  `apply --carrier <新载体> --migrate-carrier`，不要手改后混入容器件）
- 栈与命令单源：`.devcontainer/stack.json` `services[]`（lint / 测试 / dev server 命令一律读它，勿另立）

## 质量门禁（与 devcontainer 载体同源）

- 交付前：`bash .claude/hooks/lint-gate.sh`（Stop hook 同口径；按 stack.json 路由）
- 提交前：pre-commit（`.pre-commit-config.yaml` 挂 lint-gate）
- native 载体：lint-gate 经 git-for-windows bash 执行（jq 依赖 winget 基座 `jqlang.jq`）
- macos 载体：lint-gate / pre-commit 在宿主 shell 执行（依赖工具经 host-bootstrap dev-tools 模块供给——
  `host-setup.sh check` 体检；make / python3 来自 Xcode CLT）

## 模块不变量

<!-- 每模块一条：目录 → 关键不变量（并发 / 状态 / 数据流红线）；复杂模块可另建 <模块>/CLAUDE.md 细化 -->
- `<svc>/` —— <不变量>

## 命令速查

- 依赖同步：`make sync`（**首次手动执行**，无容器钩子代跑）
- lint 全量：`make lint`（等价 `CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh`）
- 质量棘轮：日常 `python3 .devcontainer/scripts/quality_ratchet_check.py`（复杂度基线只准收缩——新增违规即红；改善后 `--prune` 回写收缩；基线勿手改数值）
- 测试 / dev server：以 stack.json `test_cmd` / `dev_cmd` 为单源

## 禁止事项

- 不引入 `.devcontainer/` 容器件（devcontainer.json / Dockerfile / features 等）——本项目载体已声明，
  混入两套开发环境定义会被 apply 互斥保护拒绝
- <!-- 项目特定红线 -->
