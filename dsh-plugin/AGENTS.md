# dsh-plugin/ 插件包约定（host + client + helper）

> dsh（DeepSeek Harness）Cordis 插件形态：宿主半边 `src/host/`（Node）+ 客户端半边 `src/client/`（React，
> `plugins.detail.section` 页面载体）+ 桌宠 `helper/`（Electron sidecar 子包，workspace member
> `dsh-plugin-helper`）。模块挂点职责见各子目录 README.md；设计与决策见 `specs/dsh-plugin/` 与
> `docs/decisions/0001|0002`。

## 不变量与红线

- **业务核心零 dsh 依赖**：`domain/ radio/ judge/ anonymize/ dispatch/ storage/` 是纯逻辑 + SQL 原语，
  不 import 任何 dsh/Cordis 平台面；平台面（timer/subagent/worktrees/SSH/slots/terminal）只允许在
  适配层（`index.ts` 装配、后续 tools 注册面、pet/dispatch 适配缝）触碰——RC 期破坏性变更被限制在薄适配层。
- **storage 是全插件唯一握连接的模块**：连接生命周期（WAL + busy_timeout=5000）、guarded 迁移**封顶
  minSchema**（`contracts/PROTOCOL.md` §1；「把库版本推到更高」只由主应用执行）、`BEGIN IMMEDIATE`
  事务助手。其他模块不得自开连接。
- **写路径铁律**：全部写操作 = 单条 `BEGIN IMMEDIATE` 短事务 + CAS（WHERE 守卫、affected rows 判定）；
  禁止长事务、禁止事务内子进程调用/await（ADR-0001）。
- **domain 与 Rust 逐 `contracts/PROTOCOL.md` 对齐（FR-X3）**：行为以 `contracts/fixtures/` 锁定的代码
  行为为准；发现与 AD 文字矩阵差异时 TS 对齐实际行为，并在代码注释标注差异点（见 PROTOCOL §5「代码优先
  行为发现」清单，如 conn 层不设状态迁移守卫、停用维度建标签放行）——不要"顺手修正"为文档语义。
- **coverage 口径**：`vite.config.ts` thresholds 四维 85 只统计 `src/host/**`（business core）；
  client 组件不入口径但**进质量棘轮**（复杂度/覆盖率地板按服务全量）。**不要把 vite.config.ts 改名为
  vitest.config.ts**（会脱离棘轮发现面）。
- **helper 独立子包**：不依赖 dsh 运行时，由插件 `pet/` spawn；测试三形态（Electron 真窗体 / headless
  `HELPER_HEADLESS=1`（CI 无显示环境）/ 生产 `dist/main.js`）；桥协议单源 = `helper/README.md`
  §桥协议（stdio JSON 行），host 侧 `pet/bridge.ts` 与 helper 两侧同步改。
- **i18n 三语键集相等**：主应用字典经 `@app-i18n` alias 直引 `src/i18n/*.ts` TS 源（A16 零拷贝），
  `dsh.*` 增量键三语字典在 `src/client/i18n/`；`__tests__/client/i18n.spec.ts` 断言三语 merged 键集
  完全相等（缺键即红，NFR-7）。
- **测试用真实临时 SQLite**：契约回放与 domain 原语测试在真实临时库文件上执行（不用内存 mock 替代
  WAL/事务语义）；外部依赖（lark-cli/agent CLI/子进程）走 fake 脚本替身。
- **TODO 纪律**：源码内不落 TODO 字面量（全仓棘轮 hygiene 基线 = 0），待办写各模块 README.md（.md
  不入卫生扫描口径）。

## 命令速查（stack.json `dsh-plugin` 服务单源）

- lint：`pnpm --filter dsh-plugin lint`（eslint + prettier + tsc --noEmit 分脚本）
- 测试：`pnpm --filter dsh-plugin test`（vitest 全量，含契约回放与组件测试）
- helper：`pnpm --filter dsh-plugin-helper test|build|dev`（dev 需本机 electron；CI 跳过二进制下载）
- 契约夹具重生成：见 `contracts/AGENTS.md`
