# Tasks

## 1. 阶段一：agent-plugins 资产搬家与双消费方适配

- [x] 1.1 `git mv src-tauri/skills/pokemon-choose-you.md agent-plugins/skills/pokemon-choose-you/SKILL.md`，references 两文件随迁同目录；删除 `src-tauri/skills/`。验证：`git status` 显示 rename 而非 add+delete，frontmatter 内容零变化。
- [x] 1.2 Rust 侧适配：`src-tauri/src/skills.rs` 内嵌路径改为 `../../agent-plugins/skills/...`；`SKILL_VERSION` 常量替换为 LazyLock 解析内嵌 MD frontmatter（复用 `frontmatter_version` 逻辑），消费点（skill.rs/doctor.rs/commands/skills.rs）改用解析值。验证：`cargo test` 全绿 + 新增断言「解析值 == frontmatter 字面值」的单测。
- [x] 1.3 dsh-plugin 侧适配：`src/host/skills-raw.ts` 与 vite raw 路径指向 `agent-plugins/skills/`；`domain/skills.ts` 逻辑不变。验证：`pnpm test` 技能相关用例绿 + 内嵌与磁盘文件字节一致断言存在。
- [x] 1.4 新增 `agent-plugins/AGENTS.md` 不变量（单源、双内嵌、frontmatter 版本唯一源、fixtures 禁手改引用 contracts）；根 `AGENTS.md` 模块表补 `agent-plugins/` 条目。验证：文档 review + lint-gate 绿。
- [x] 1.5 阶段验收：`CLAUDE_PROJECT_DIR=. bash .claude/hooks/lint-gate.sh` 全绿；`pk doctor` 在本地跑通（技能版本检出正常）。验证：命令输出无旧版技能警告。

## 2. 阶段二：CLI 信封契约组与 Rust oracle

- [x] 2.1 定义场景 schema：`contracts/scenarios/cli_envelope/<name>.json`（argv、env 覆盖、库种子、期望归一化字段）；先覆盖每命令族代表命令（task create/list/done、note、log、session、dispatch、suggest 单条与 batch、category/tag、context、skill install 干跑、doctor、help --json、version、remote shim）。验证：schema 草案 review 通过后落盘。
- [x] 2.2 Rust oracle：集成测试经 `CARGO_BIN_EXE_pk` spawn pk，按场景设 `PK_DB`/env，捕获 stdout/退出码，归一化（`<ts:N>`/`<pk-version>`/`<home>`）后 `UPDATE_FIXTURES=1` 写 `contracts/fixtures/cli_envelope/`。验证：`UPDATE_FIXTURES=1 cargo test` 生成 fixtures，无变量比对模式（默认）亦绿。
- [x] 2.3 完备性断言：oracle 侧断言执行场景数 == scenarios 目录文件数。验证：新增场景文件后两侧计数测试同步红（TDD 先红后绿）。
- [x] 2.4 `contracts/AGENTS.md` 补信封契约组条目（fixtures 禁手改、再生命令、归一化字段表）。验证：lint-gate 绿。

## 3. 阶段三：TS pk 数据面命令

- [x] 3.1 脚手架：`dsh-plugin/src/pk/main.ts`（argv 分发器、退出码约定）+ `cli.ts`（pretty JSON 信封、stderr `{"error":...}`）+ `help.ts`（COMMAND_INDEX，与 Rust `pk help --json` 结构对齐）+ `version.ts`（构建期注入）。验证：`node dist/pk.mjs help --json` 与 `version` 跑通（本地 esbuild 手动打包验证）。
- [x] 3.2 数据面命令实现：task 家族（含 --dry-run）、note/log、session、dispatch、suggest（单条 + batch stdin 协议 + 假名还原）、category/tag、context、init-db——import `host/domain` + `host/storage`，参数校验对齐 Rust 用法语（错误退出码 2）。验证：每命令域单测 + `pnpm test` 全绿。
- [x] 3.3 信封回放：vitest spawn `node dist/pk.mjs` 执行 `cli_envelope` 全部数据面场景，stdout 解析为字段树与 fixtures 逐字段比对；完备性断言（场景数 == 文件数）。验证：数据面场景回放绿。
- [x] 3.4 依赖图 guard：esbuild metafile 生成 pk 依赖清单，测试断言无 `dsh/`、`radio/`、`dispatch/` 平台面路径。验证：guard 测试绿（临时引入平台面 import 时变红，TDD 演示）。
- [x] 3.5 `pk skill install/show` TS 实现（四 agent 目录映射、落盘结构、版本对比报告；无 SSH 远端分支）。验证：临时 HOME 集成测试落盘断言 + 信封场景绿。

## 4. 阶段四：TS pk remote 家族

- [ ] 4.1 `remote shim` 命令：脚本模板生成（直连形态 + 参数项），与 Rust 版逐字对齐。验证：信封场景比对逐字节一致（归一化 `<home>`）。
- [ ] 4.2 ssh 编排底座：`src/pk/ssh.ts` 自持 execFile ssh/ssh-keygen/ssh-keyscan（BatchMode、ConnectTimeout、step timeout 到期 kill、`PK_SSH_BIN` 覆盖）。验证：注入假 ssh 二进制（PATH shim 记录调用参数）的单测断言参数构造与超时语义。
- [ ] 4.3 `remote setup` 九步移植：authorized_keys 四形态收口、known_hosts 改写、私钥 stdin 推送、shim 落位、登录 shell PATH 验证、端到端验证 + ControlPersist master 收尾；SetupReport（camelCase ok/steps/version）入信封场景。验证：四形态收口与各步命令构造单测 + SetupReport 信封场景绿。
- [ ] 4.4 Windows 分支：icacls 权限命令构造、路径反斜杠转义、shim 无 env 段形态、`__ssh_entry` 大小写不敏感比较。验证：命令构造单测（不依赖真 Windows）+ 信封场景含 Windows 形态断言。
- [ ] 4.5 `__ssh_entry`：shlex 子集解析器移植（引号/转义/零展开/畸形即拒）、env 白名单、realpathSync 等价判定、spawn `process.execPath`+自身 argv 直启、拒绝退出码 78。验证：解析器单测表驱动（合法/白名单外/程序不匹配/畸形四类）+ E2E：本机真开 sshd 场景执行 forced-command 冒烟（macOS 宿主）。
- [ ] 4.6 `pk doctor` TS 版对齐（含 `--ssh`）；node 环境检测项按 design Open Question 结论落（增补不改既有语义）。验证：信封场景 + 手工对照 Rust doctor 输出结构。

## 5. 阶段五：构建分发切换与收尾

- [ ] 5.1 esbuild 正式入口：`src/pk/main.ts` → `dist/pk.mjs`（单文件 ESM、shebang banner、`define` 注入包版本）挂入 `build.mjs`；`package.json` files 增产物。验证：`pnpm build`（dsh-plugin）产出 `dist/pk.mjs`，`node dist/pk.mjs --version` 输出包版本。
- [ ] 5.2 落位切换：`pkLocal.ts` `ensureLocalPk()` 拷贝源改 `dist/pk.mjs`，落位 `~/.choose-you/bin/pk`（Windows 另落 `pk.cmd` 包装），sha256 漂移重拷不变。验证：单测（临时 HOME 落位断言 + 漂移重拷）+ 本机真落位后 PATH 中 `pk --version` 冒烟。
- [ ] 5.3 vendor 移除：删 `build.mjs` vendor 拷贝段与 `dsh-plugin/vendor/`；确认 `pkSetup.ts` spawn 路径无需改动（落位文件形态变化对调用方透明）。验证：`pnpm build` 产物无 `vendor/`、`deploymentSetupPk` 命令集成测试绿。
- [ ] 5.4 文档收尾：`dsh-plugin/AGENTS.md`（src/pk/ 不变量、零平台面依赖、信封回放入口）、`docs/debt.md` 无新增遗留。验证：review + lint-gate 绿。
- [ ] 5.5 ADR 留痕：新增 `docs/decisions/0006-remote-setup-dual-implementation-per-host.md`（内容按 design D6），`0003` 头部加 superseded 注记。验证：ADR review 通过。
- [ ] 5.6 全量验收：`pnpm test`、`pnpm test:rust:coverage`、`cargo test`、`pnpm check:duplicates`、`python3 .devcontainer/scripts/quality_ratchet_check.py` 全绿；E2E：`specs/pk-cli/spec.md` 每 Scenario ≥ 1 用例（raw 报告落 `openspec/changes/ts-pk-and-agent-plugins/reports/`）；`pnpm build` + `pnpm audit:npm` + `gitleaks detect` 通过。

## Workflow follow-up

- 全部任务完成后走 openspec-apply-change 的收尾与 openspec-archive-change 归档（specs 并入主规格库）。
- 验收 E2E 用 e2e-acceptance 技能执行；接口侧若有新命令面冒烟需求用 api-contract-test 技能。
