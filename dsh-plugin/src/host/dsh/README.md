# dsh/ —— 平台胶水层（host 半边真实适配，Phase A）

> 业务核心零 dsh 依赖（AGENTS.md 铁律）的例外边界：本目录是**唯一**允许 import dsh/Cordis
> 平台面的 host 侧目录。RC 期 dsh 破坏性变更被限制在这一薄层内消化。

## 模块挂点

- `hostEntry.ts` —— 插件入口（loader 消费 `name`/`inject`/`Config`/`apply`）：
  能力探测（node:sqlite 硬拒绝）→ `createPlugin` 真实装配（ctx.interval 映射 timer、
  helper/electron 探测桌宠、judgeExecutor 配置分流）→ 22 工具经 defineTool 注册 →
  host 命令挂 `PkyRemoteService`（Typert Remote 数据面，见下）。
- `toolSchema.ts` —— 22 工具参数类型表 + `toDslParameters` 映射器（我们 ParamDecl →
  dsh defineTool 的 JSON DSL 判别联合）；完整性测试锁表键集 == 注册表参数摘要。
- `remoteService.ts` —— host→客户端数据面（Typert Remote，2026-10-13 迁移）：
  `PkyRemoteService extends TypertRemoteService`（`super(ctx, "pky")`——服务名即 wire
  命名空间），单方法 `@Remote("call")` 转发 `plugin.commands`（69 命令不拆分），业务
  信封（PROTOCOL §2）作 Remote 返回值原样透传——api-gateway 在共享 `/api` 通道按端点
  `pky/call` 经 SRC 模式解析（源码参数名 = wire 字段；**本包构建不 minify 是 SRC 解析
  的硬依赖**），gateway 经 `ctx.get("pky")` 直取服务——无消费方 inject、无晚供问题。
  原自定义通道（connection.rpc.handle "/pky"）在 rc.2 对第三方不可用（影子 ctx 读
  owner.webServer 撞严格制——证据链见 debt.md 历史条目），rpcDispatch.ts/rpcChannel.ts
  已删除。

## 验证口径

- 单测：`__tests__/dsh-tool-schema.spec.ts`（纯逻辑件）；Remote 链路真机验证走
  pky-test profile（`dsh --profile pky-test --no-open --port <p>` 后浏览器开面板看真数据）。
- hostEntry 接线面不进覆盖率门禁（vite.config.ts exclude——GUI 胶水同口径），真实加载走
  profile 安装冒烟（新建测试 profile，勿动 web/desktop）。
- client 半边（Phase B 已落型）：`src/client/dsh/`（module-loader bundle + slots 注册 + RPC transport，
  见该目录 README）；本层 rpcDispatch 的信封转换由其 transport.ts 逆向还原。
