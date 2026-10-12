# dsh/ —— 平台胶水层（host 半边真实适配，Phase A）

> 业务核心零 dsh 依赖（AGENTS.md 铁律）的例外边界：本目录是**唯一**允许 import dsh/Cordis
> 平台面的 host 侧目录。RC 期 dsh 破坏性变更被限制在这一薄层内消化。

## 模块挂点

- `hostEntry.ts` —— 插件入口（loader 消费 `name`/`inject`/`Config`/`apply`）：
  能力探测（node:sqlite 硬拒绝）→ `createPlugin` 真实装配（ctx.interval 映射 timer、
  helper/electron 探测桌宠、judgeExecutor 配置分流）→ 22 工具经 defineTool 注册 →
  50 host 命令挂 `pky/<command>` RPC 端点（`ctx.inject(["connection"])`——headless 组合
  无 connection 服务，入口 inject 不含它，避免阻断 headless 启动）。
- `toolSchema.ts` —— 22 工具参数类型表 + `toDslParameters` 映射器（我们 ParamDecl →
  dsh defineTool 的 JSON DSL 判别联合）；完整性测试锁表键集 == 注册表参数摘要。
- `rpcDispatch.ts` —— `pky/<command>` 端点归属/解析 + host 命令信封 → dsh
  ConnectionRpcHandlerResult 转换（hint 落 `error.details.hint`，客户端半边逆向还原）。

## 验证口径

- 单测：`__tests__/dsh-tool-schema.spec.ts` / `__tests__/dsh-rpc-dispatch.spec.ts`（纯逻辑件）。
- hostEntry 接线面不进覆盖率门禁（vite.config.ts exclude——GUI 胶水同口径），真实加载走
  profile 安装冒烟（新建测试 profile，勿动 web/desktop）。
- client 半边（Phase B 已落型）：`src/client/dsh/`（module-loader bundle + slots 注册 + RPC transport，
  见该目录 README）；本层 rpcDispatch 的信封转换由其 transport.ts 逆向还原。
